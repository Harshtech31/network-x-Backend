const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../config/aws');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS, invalidateClubCache } = require('../config/redis');
const User = require('../models/mongodb/User');
const RealtimeService = require('../services/realtime');

const router = express.Router();
const CLUBS_TABLE = process.env.DYNAMODB_CLUBS_TABLE || 'networkx-clubs';

// GET /api/clubs - Get all clubs with pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, status } = req.query;
    const cacheKey = `clubs:all:${page}:${limit}:${category || 'all'}:${status || 'all'}`;
    
    // Try cache first
    const cachedClubs = await getCache(cacheKey);
    if (cachedClubs) {
      return res.json(cachedClubs);
    }

    // Get clubs from DynamoDB
    let clubs = await scanItems(CLUBS_TABLE, null, {}, parseInt(limit));
    
    // Apply filters
    if (category) {
      clubs = clubs.filter(club => club.category === category);
    }
    if (status) {
      clubs = clubs.filter(club => club.status === status);
    }
    
    // Get user details for each club
    const clubsWithUsers = await Promise.all(
      clubs.map(async (club) => {
        const user = await User.findById(club.presidentId).select('firstName lastName username profileImage');
        return {
          ...club,
          president: user
        };
      })
    );

    // Sort by member count (most members first)
    clubsWithUsers.sort((a, b) => b.memberCount - a.memberCount);

    const result = {
      clubs: clubsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: clubsWithUsers.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get clubs error:', error);
    res.status(500).json({ error: 'Failed to fetch clubs' });
  }
});

// POST /api/clubs - Create new club
router.post('/', authenticateToken, uploadMiddleware.clubMedia, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      category, 
      rules, 
      visibility = 'public',
      requiresApproval = false
    } = req.body;
    const clubId = uuidv4();
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Club name is required' });
    }
    
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: 'Club description is required' });
    }

    const mediaUrls = req.files ? req.files.map(file => file.location) : [];
    
    const club = {
      clubId,
      presidentId: req.user.id,
      name: name.trim(),
      description: description.trim(),
      category: category || 'general',
      rules: rules ? rules.split('\n').map(rule => rule.trim()).filter(rule => rule) : [],
      visibility,
      requiresApproval,
      mediaUrls,
      members: [req.user.id],
      memberCount: 1,
      officers: [req.user.id],
      applications: [],
      applicationCount: 0,
      posts: [],
      postCount: 0,
      events: [],
      eventCount: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(CLUBS_TABLE, club);

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseClub = {
      ...club,
      president: user
    };

    // Invalidate cache
    await invalidateClubCache(clubId, req.user.id);

    res.status(201).json({
      message: 'Club created successfully',
      club: responseClub
    });
  } catch (error) {
    console.error('Create club error:', error);
    res.status(500).json({ error: 'Failed to create club' });
  }
});

// GET /api/clubs/:id - Get specific club
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.CLUB_DETAILS(id);
    
    // Try cache first
    const cachedClub = await getCache(cacheKey);
    if (cachedClub) {
      return res.json(cachedClub);
    }

    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Get user details
    const user = await User.findById(club.presidentId).select('firstName lastName username profileImage');
    
    const responseClub = {
      ...club,
      president: user
    };

    // Cache for 10 minutes
    await setCache(cacheKey, responseClub, 600);
    
    res.json(responseClub);
  } catch (error) {
    console.error('Get club error:', error);
    res.status(500).json({ error: 'Failed to fetch club' });
  }
});

// PUT /api/clubs/:id - Update club
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, rules, visibility, requiresApproval } = req.body;
    
    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    if (club.presidentId !== req.user.id && !club.officers.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized to update this club' });
    }

    const updateExpression = 'SET #name = :name, #description = :description, #category = :category, #rules = :rules, #visibility = :visibility, #requiresApproval = :requiresApproval, #updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#name': 'name',
      '#description': 'description',
      '#category': 'category',
      '#rules': 'rules',
      '#visibility': 'visibility',
      '#requiresApproval': 'requiresApproval',
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues = {
      ':name': name?.trim() || club.name,
      ':description': description?.trim() || club.description,
      ':category': category || club.category,
      ':rules': rules ? rules.split('\n').map(rule => rule.trim()).filter(rule => rule) : club.rules,
      ':visibility': visibility || club.visibility,
      ':requiresApproval': requiresApproval !== undefined ? requiresApproval : club.requiresApproval,
      ':updatedAt': new Date().toISOString()
    };

    const updatedClub = await updateItem(
      CLUBS_TABLE,
      { clubId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseClub = {
      ...updatedClub,
      president: user
    };

    // Invalidate cache
    await invalidateClubCache(id, req.user.id);

    res.json({
      message: 'Club updated successfully',
      club: responseClub
    });
  } catch (error) {
    console.error('Update club error:', error);
    res.status(500).json({ error: 'Failed to update club' });
  }
});

// DELETE /api/clubs/:id - Delete club
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    if (club.presidentId !== req.user.id) {
      return res.status(403).json({ error: 'Only the president can delete this club' });
    }

    await deleteItem(CLUBS_TABLE, { clubId: id });

    // Invalidate cache
    await invalidateClubCache(id, req.user.id);

    res.json({ message: 'Club deleted successfully' });
  } catch (error) {
    console.error('Delete club error:', error);
    res.status(500).json({ error: 'Failed to delete club' });
  }
});

// POST /api/clubs/:id/join - Join club
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    
    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    if (club.members && club.members.includes(userId)) {
      return res.status(400).json({ error: 'Already a member of this club' });
    }

    if (club.requiresApproval) {
      // Add to applications
      const applications = club.applications || [];
      const existingApplication = applications.find(app => app.userId === userId);
      
      if (existingApplication) {
        return res.status(400).json({ error: 'Already applied to join this club' });
      }

      const application = {
        applicationId: uuidv4(),
        userId,
        message: message || '',
        status: 'pending',
        appliedAt: new Date().toISOString()
      };

      applications.push(application);

      const updateExpression = 'SET applications = :applications, applicationCount = :applicationCount, updatedAt = :updatedAt';
      const expressionAttributeValues = {
        ':applications': applications,
        ':applicationCount': applications.length,
        ':updatedAt': new Date().toISOString()
      };

      await updateItem(
        CLUBS_TABLE,
        { clubId: id },
        updateExpression,
        expressionAttributeValues
      );

      // Send real-time notification for application
      await RealtimeService.handleClubInteraction(
        id, 
        club.presidentId, 
        'apply', 
        req.user
      );

      res.status(201).json({
        message: 'Application submitted successfully. Awaiting approval.',
        application
      });
    } else {
      // Direct join
      const members = club.members || [];
      members.push(userId);

      const updateExpression = 'SET members = :members, memberCount = :memberCount, updatedAt = :updatedAt';
      const expressionAttributeValues = {
        ':members': members,
        ':memberCount': members.length,
        ':updatedAt': new Date().toISOString()
      };

      await updateItem(
        CLUBS_TABLE,
        { clubId: id },
        updateExpression,
        expressionAttributeValues
      );

      // Send real-time notification for direct join
      await RealtimeService.handleClubInteraction(
        id, 
        club.presidentId, 
        'join', 
        req.user
      );

      res.json({
        message: 'Successfully joined the club',
        memberCount: members.length
      });
    }

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CLUB_DETAILS(id));
    await deleteCache(CACHE_KEYS.CLUB_MEMBERS(id));
  } catch (error) {
    console.error('Join club error:', error);
    res.status(500).json({ error: 'Failed to join club' });
  }
});

// POST /api/clubs/:id/leave - Leave club
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    if (club.presidentId === userId) {
      return res.status(400).json({ error: 'President cannot leave the club. Transfer presidency first.' });
    }

    if (!club.members || !club.members.includes(userId)) {
      return res.status(400).json({ error: 'Not a member of this club' });
    }

    const members = club.members.filter(memberId => memberId !== userId);
    const officers = club.officers ? club.officers.filter(officerId => officerId !== userId) : [];

    const updateExpression = 'SET members = :members, memberCount = :memberCount, officers = :officers, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':members': members,
      ':memberCount': members.length,
      ':officers': officers,
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      CLUBS_TABLE,
      { clubId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CLUB_DETAILS(id));
    await deleteCache(CACHE_KEYS.CLUB_MEMBERS(id));

    res.json({
      message: 'Successfully left the club',
      memberCount: members.length
    });
  } catch (error) {
    console.error('Leave club error:', error);
    res.status(500).json({ error: 'Failed to leave club' });
  }
});

// PUT /api/clubs/:id/applications/:applicationId - Accept/reject membership application
router.put('/:id/applications/:applicationId', authenticateToken, async (req, res) => {
  try {
    const { id, applicationId } = req.params;
    const { status } = req.body; // 'accepted' or 'rejected'
    
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected' });
    }

    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    if (club.presidentId !== req.user.id && !club.officers.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized to manage applications for this club' });
    }

    const applications = club.applications || [];
    const applicationIndex = applications.findIndex(app => app.applicationId === applicationId);
    
    if (applicationIndex === -1) {
      return res.status(404).json({ error: 'Application not found' });
    }

    applications[applicationIndex].status = status;
    applications[applicationIndex].reviewedAt = new Date().toISOString();

    let updateExpression = 'SET applications = :applications, updatedAt = :updatedAt';
    let expressionAttributeValues = {
      ':applications': applications,
      ':updatedAt': new Date().toISOString()
    };

    // If accepted, add user to members
    if (status === 'accepted') {
      const members = club.members || [];
      const applicantId = applications[applicationIndex].userId;
      
      if (!members.includes(applicantId)) {
        members.push(applicantId);
        updateExpression += ', members = :members, memberCount = :memberCount';
        expressionAttributeValues[':members'] = members;
        expressionAttributeValues[':memberCount'] = members.length;
      }
    }

    await updateItem(
      CLUBS_TABLE,
      { clubId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CLUB_DETAILS(id));
    await deleteCache(CACHE_KEYS.CLUB_MEMBERS(id));

    res.json({
      message: `Application ${status} successfully`,
      application: applications[applicationIndex]
    });
  } catch (error) {
    console.error('Update club application error:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// GET /api/clubs/:id/members - Get club members
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.CLUB_MEMBERS(id);
    
    // Try cache first
    const cachedMembers = await getCache(cacheKey);
    if (cachedMembers) {
      return res.json(cachedMembers);
    }

    const club = await getItem(CLUBS_TABLE, { clubId: id });
    
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const memberIds = club.members || [];
    const officerIds = club.officers || [];
    
    // Get user details for each member
    const members = await Promise.all(
      memberIds.map(async (memberId) => {
        const user = await User.findById(memberId).select('firstName lastName username profileImage bio');
        return {
          ...user.toObject(),
          isOfficer: officerIds.includes(memberId),
          isPresident: club.presidentId === memberId
        };
      })
    );

    const result = {
      members: members.filter(member => member !== null),
      total: members.length,
      officers: members.filter(member => member.isOfficer),
      president: members.find(member => member.isPresident)
    };

    // Cache for 15 minutes
    await setCache(cacheKey, result, 900);
    
    res.json(result);
  } catch (error) {
    console.error('Get club members error:', error);
    res.status(500).json({ error: 'Failed to fetch club members' });
  }
});

// GET /api/clubs/user/:userId - Get user clubs
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = `clubs:user:${userId}:${page}:${limit}`;
    
    // Try cache first
    const cachedClubs = await getCache(cacheKey);
    if (cachedClubs) {
      return res.json(cachedClubs);
    }

    // Get all clubs and filter by membership
    const allClubs = await scanItems(CLUBS_TABLE);
    const userClubs = allClubs.filter(club => 
      club.members && club.members.includes(userId)
    );

    // Get user details for each club
    const clubsWithUsers = await Promise.all(
      userClubs.map(async (club) => {
        const user = await User.findById(club.presidentId).select('firstName lastName username profileImage');
        return {
          ...club,
          president: user,
          userRole: club.presidentId === userId ? 'president' : 
                   (club.officers && club.officers.includes(userId) ? 'officer' : 'member')
        };
      })
    );

    const result = {
      clubs: clubsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: clubsWithUsers.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get user clubs error:', error);
    res.status(500).json({ error: 'Failed to fetch user clubs' });
  }
});

module.exports = router;
