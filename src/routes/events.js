const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../config/aws');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS, invalidateEventCache } = require('../config/redis');
const User = require('../models/mongodb/User');
const RealtimeService = require('../services/realtime');

const router = express.Router();
const EVENTS_TABLE = process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events';

// GET /api/events - Get all events with pagination and filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, status, upcoming } = req.query;
    const cacheKey = `events:all:${page}:${limit}:${category || 'all'}:${status || 'all'}:${upcoming || 'all'}`;
    
    // Try cache first
    const cachedEvents = await getCache(cacheKey);
    if (cachedEvents) {
      return res.json(cachedEvents);
    }

    // Get events from DynamoDB
    let events = await scanItems(EVENTS_TABLE, null, {}, parseInt(limit));
    
    // Apply filters
    if (category) {
      events = events.filter(event => event.category === category);
    }
    if (status) {
      events = events.filter(event => event.status === status);
    }
    if (upcoming === 'true') {
      const now = new Date().toISOString();
      events = events.filter(event => event.startDate > now);
    }
    
    // Get user details for each event
    const eventsWithUsers = await Promise.all(
      events.map(async (event) => {
        const user = await User.findById(event.organizerId).select('firstName lastName username profileImage');
        return {
          ...event,
          organizer: user
        };
      })
    );

    // Sort by start date (upcoming first)
    eventsWithUsers.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    const result = {
      events: eventsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: eventsWithUsers.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /api/events - Create new event
router.post('/', authenticateToken, uploadMiddleware.eventMedia, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      category, 
      startDate, 
      endDate, 
      location, 
      maxAttendees, 
      requiresRegistration = false,
      visibility = 'public',
      clubId 
    } = req.body;
    const eventId = uuidv4();
    
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Event title is required' });
    }
    
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: 'Event description is required' });
    }

    if (!startDate) {
      return res.status(400).json({ error: 'Event start date is required' });
    }

    const mediaUrls = req.files ? req.files.map(file => file.location) : [];
    
    const event = {
      eventId,
      organizerId: req.user.id,
      title: title.trim(),
      description: description.trim(),
      category: category || 'general',
      startDate: new Date(startDate).toISOString(),
      endDate: endDate ? new Date(endDate).toISOString() : null,
      location: location || null,
      maxAttendees: maxAttendees ? parseInt(maxAttendees) : null,
      requiresRegistration,
      visibility,
      clubId: clubId || null,
      mediaUrls,
      attendees: [req.user.id],
      attendeeCount: 1,
      registrations: [],
      registrationCount: 0,
      status: 'upcoming',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(EVENTS_TABLE, event);

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseEvent = {
      ...event,
      organizer: user
    };

    // Invalidate cache
    await invalidateEventCache(eventId, req.user.id);

    res.status(201).json({
      message: 'Event created successfully',
      event: responseEvent
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// GET /api/events/:id - Get specific event
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.EVENT_DETAILS(id);
    
    // Try cache first
    const cachedEvent = await getCache(cacheKey);
    if (cachedEvent) {
      return res.json(cachedEvent);
    }

    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get user details
    const user = await User.findById(event.organizerId).select('firstName lastName username profileImage');
    
    const responseEvent = {
      ...event,
      organizer: user
    };

    // Cache for 10 minutes
    await setCache(cacheKey, responseEvent, 600);
    
    res.json(responseEvent);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// PUT /api/events/:id - Update event
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, startDate, endDate, location, maxAttendees, requiresRegistration, visibility, status } = req.body;
    
    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.organizerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this event' });
    }

    const updateExpression = 'SET #title = :title, #description = :description, #category = :category, #startDate = :startDate, #endDate = :endDate, #location = :location, #maxAttendees = :maxAttendees, #requiresRegistration = :requiresRegistration, #visibility = :visibility, #status = :status, #updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#title': 'title',
      '#description': 'description',
      '#category': 'category',
      '#startDate': 'startDate',
      '#endDate': 'endDate',
      '#location': 'location',
      '#maxAttendees': 'maxAttendees',
      '#requiresRegistration': 'requiresRegistration',
      '#visibility': 'visibility',
      '#status': 'status',
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues = {
      ':title': title?.trim() || event.title,
      ':description': description?.trim() || event.description,
      ':category': category || event.category,
      ':startDate': startDate ? new Date(startDate).toISOString() : event.startDate,
      ':endDate': endDate ? new Date(endDate).toISOString() : event.endDate,
      ':location': location !== undefined ? location : event.location,
      ':maxAttendees': maxAttendees !== undefined ? (maxAttendees ? parseInt(maxAttendees) : null) : event.maxAttendees,
      ':requiresRegistration': requiresRegistration !== undefined ? requiresRegistration : event.requiresRegistration,
      ':visibility': visibility || event.visibility,
      ':status': status || event.status,
      ':updatedAt': new Date().toISOString()
    };

    const updatedEvent = await updateItem(
      EVENTS_TABLE,
      { eventId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseEvent = {
      ...updatedEvent,
      organizer: user
    };

    // Invalidate cache
    await invalidateEventCache(id, req.user.id);

    res.json({
      message: 'Event updated successfully',
      event: responseEvent
    });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/events/:id - Delete event
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.organizerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    await deleteItem(EVENTS_TABLE, { eventId: id });

    // Invalidate cache
    await invalidateEventCache(id, req.user.id);

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// POST /api/events/:id/attend - Attend/unattend event
router.post('/:id/attend', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const attendees = event.attendees || [];
    const isAttending = attendees.includes(userId);
    
    if (event.requiresRegistration && !isAttending) {
      return res.status(400).json({ error: 'This event requires registration. Please register first.' });
    }

    let updateExpression, expressionAttributeValues;
    
    if (isAttending) {
      // Unattend
      const newAttendees = attendees.filter(id => id !== userId);
      updateExpression = 'SET attendees = :attendees, attendeeCount = :attendeeCount, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':attendees': newAttendees,
        ':attendeeCount': newAttendees.length,
        ':updatedAt': new Date().toISOString()
      };
    } else {
      // Check max attendees limit
      if (event.maxAttendees && attendees.length >= event.maxAttendees) {
        return res.status(400).json({ error: 'Event is at maximum capacity' });
      }
      
      // Attend
      const newAttendees = [...attendees, userId];
      updateExpression = 'SET attendees = :attendees, attendeeCount = :attendeeCount, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':attendees': newAttendees,
        ':attendeeCount': newAttendees.length,
        ':updatedAt': new Date().toISOString()
      };
    }

    const updatedEvent = await updateItem(
      EVENTS_TABLE,
      { eventId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.EVENT_DETAILS(id));
    await deleteCache(CACHE_KEYS.EVENT_ATTENDEES(id));

    // Send real-time notification
    await RealtimeService.handleEventInteraction(
      id, 
      event.organizerId, 
      'attend', 
      req.user,
      { attending: !isAttending }
    );

    res.json({
      message: isAttending ? 'Removed from event' : 'Added to event',
      attending: !isAttending,
      attendeeCount: updatedEvent.attendeeCount
    });
  } catch (error) {
    console.error('Attend event error:', error);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

// POST /api/events/:id/register - Register for event
router.post('/:id/register', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    
    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.requiresRegistration) {
      return res.status(400).json({ error: 'This event does not require registration' });
    }

    if (event.attendees && event.attendees.includes(userId)) {
      return res.status(400).json({ error: 'Already attending this event' });
    }

    const registrations = event.registrations || [];
    const existingRegistration = registrations.find(reg => reg.userId === userId);
    
    if (existingRegistration) {
      return res.status(400).json({ error: 'Already registered for this event' });
    }

    // Check max attendees limit
    if (event.maxAttendees && event.attendeeCount >= event.maxAttendees) {
      return res.status(400).json({ error: 'Event is at maximum capacity' });
    }

    const registration = {
      registrationId: uuidv4(),
      userId,
      message: message || '',
      status: 'approved', // Auto-approve for now
      registeredAt: new Date().toISOString()
    };

    registrations.push(registration);
    const attendees = event.attendees || [];
    attendees.push(userId);

    const updateExpression = 'SET registrations = :registrations, registrationCount = :registrationCount, attendees = :attendees, attendeeCount = :attendeeCount, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':registrations': registrations,
      ':registrationCount': registrations.length,
      ':attendees': attendees,
      ':attendeeCount': attendees.length,
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      EVENTS_TABLE,
      { eventId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.EVENT_DETAILS(id));
    await deleteCache(CACHE_KEYS.EVENT_ATTENDEES(id));

    // Send real-time notification
    await RealtimeService.handleEventInteraction(
      id, 
      event.organizerId, 
      'register', 
      req.user
    );

    res.status(201).json({
      message: 'Successfully registered for event',
      registration
    });
  } catch (error) {
    console.error('Register for event error:', error);
    res.status(500).json({ error: 'Failed to register for event' });
  }
});

// GET /api/events/:id/attendees - Get event attendees
router.get('/:id/attendees', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.EVENT_ATTENDEES(id);
    
    // Try cache first
    const cachedAttendees = await getCache(cacheKey);
    if (cachedAttendees) {
      return res.json(cachedAttendees);
    }

    const event = await getItem(EVENTS_TABLE, { eventId: id });
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const attendeeIds = event.attendees || [];
    
    // Get user details for each attendee
    const attendees = await Promise.all(
      attendeeIds.map(async (attendeeId) => {
        const user = await User.findById(attendeeId).select('firstName lastName username profileImage bio');
        return {
          ...user.toObject(),
          isOrganizer: event.organizerId === attendeeId
        };
      })
    );

    const result = {
      attendees: attendees.filter(attendee => attendee !== null),
      total: attendees.length,
      organizer: attendees.find(attendee => attendee.isOrganizer)
    };

    // Cache for 15 minutes
    await setCache(cacheKey, result, 900);
    
    res.json(result);
  } catch (error) {
    console.error('Get event attendees error:', error);
    res.status(500).json({ error: 'Failed to fetch event attendees' });
  }
});

// GET /api/events/user/:userId - Get user events
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type = 'all' } = req.query; // type: 'organized', 'attending', 'all'
    const cacheKey = `events:user:${userId}:${page}:${limit}:${type}`;
    
    // Try cache first
    const cachedEvents = await getCache(cacheKey);
    if (cachedEvents) {
      return res.json(cachedEvents);
    }

    let userEvents = [];
    
    if (type === 'organized' || type === 'all') {
      const organizedEvents = await queryItems(
        EVENTS_TABLE,
        'organizerId = :organizerId',
        { ':organizerId': userId },
        'OrganizerEventsIndex',
        parseInt(limit)
      );
      userEvents = [...userEvents, ...organizedEvents.map(event => ({ ...event, userRole: 'organizer' }))];
    }
    
    if (type === 'attending' || type === 'all') {
      const allEvents = await scanItems(EVENTS_TABLE);
      const attendingEvents = allEvents.filter(event => 
        event.attendees && event.attendees.includes(userId) && event.organizerId !== userId
      );
      userEvents = [...userEvents, ...attendingEvents.map(event => ({ ...event, userRole: 'attendee' }))];
    }

    // Remove duplicates and get user details
    const uniqueEvents = userEvents.filter((event, index, self) => 
      index === self.findIndex(e => e.eventId === event.eventId)
    );
    
    const eventsWithUsers = await Promise.all(
      uniqueEvents.map(async (event) => {
        const user = await User.findById(event.organizerId).select('firstName lastName username profileImage');
        return {
          ...event,
          organizer: user
        };
      })
    );

    // Sort by start date
    eventsWithUsers.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    const result = {
      events: eventsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: eventsWithUsers.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get user events error:', error);
    res.status(500).json({ error: 'Failed to fetch user events' });
  }
});

module.exports = router;
