const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const User = require('../models/mongodb/User');

const router = express.Router();
const COLLABORATIONS_TABLE = process.env.DYNAMODB_COLLABORATIONS_TABLE || 'networkx-collaborations';

// GET /api/collaborations - Get all active collaborations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = `collaborations:all:${page}:${limit}`;
    
    // Try cache first
    const cachedCollaborations = await getCache(cacheKey);
    if (cachedCollaborations) {
      return res.json(cachedCollaborations);
    }

    // Get collaborations from DynamoDB
    const collaborations = await scanItems(COLLABORATIONS_TABLE, 'isActive = :isActive', {
      ':isActive': true
    }, parseInt(limit));
    
    // Get user details for each collaboration
    const collaborationsWithUsers = await Promise.all(
      collaborations.map(async (collaboration) => {
        const creator = await User.findById(collaboration.creatorId).select('firstName lastName username profileImage');
        return {
          ...collaboration,
          creator
        };
      })
    );

    // Sort by creation date (newest first)
    collaborationsWithUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const result = {
      collaborations: collaborationsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: collaborationsWithUsers.length
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get collaborations error:', error);
    res.status(500).json({ error: 'Failed to fetch collaborations' });
  }
});

// POST /api/collaborations - Create new collaboration
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, skills, projectType, duration, budget } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const collaborationId = uuidv4();
    const collaboration = {
      collaborationId,
      creatorId: req.user.id,
      title: title.trim(),
      description: description.trim(),
      skills: skills || [],
      projectType: projectType || 'open',
      duration,
      budget,
      status: 'open',
      applicants: [],
      applicantCount: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(COLLABORATIONS_TABLE, collaboration);

    // Get creator details
    const creator = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseCollaboration = {
      ...collaboration,
      creator
    };

    // Invalidate cache
    await deleteCache('collaborations:all:1:20');

    res.status(201).json({
      message: 'Collaboration created successfully',
      collaboration: responseCollaboration
    });
  } catch (error) {
    console.error('Create collaboration error:', error);
    res.status(500).json({ error: 'Failed to create collaboration' });
  }
});

// GET /api/collaborations/:id - Get collaboration by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `collaboration:${id}`;
    
    // Try cache first
    const cachedCollaboration = await getCache(cacheKey);
    if (cachedCollaboration) {
      return res.json(cachedCollaboration);
    }

    const collaboration = await getItem(COLLABORATIONS_TABLE, { collaborationId: id });
    
    if (!collaboration) {
      return res.status(404).json({ error: 'Collaboration not found' });
    }

    // Get creator details
    const creator = await User.findById(collaboration.creatorId).select('firstName lastName username profileImage');
    
    const responseCollaboration = {
      ...collaboration,
      creator
    };

    // Cache for 10 minutes
    await setCache(cacheKey, responseCollaboration, 600);
    
    res.json(responseCollaboration);
  } catch (error) {
    console.error('Get collaboration error:', error);
    res.status(500).json({ error: 'Failed to fetch collaboration' });
  }
});

// PUT /api/collaborations/:id - Update collaboration
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, skills, projectType, duration, budget, status } = req.body;
    
    const collaboration = await getItem(COLLABORATIONS_TABLE, { collaborationId: id });
    
    if (!collaboration) {
      return res.status(404).json({ error: 'Collaboration not found' });
    }

    if (collaboration.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this collaboration' });
    }

    const updateExpression = 'SET title = :title, description = :description, skills = :skills, projectType = :projectType, duration = :duration, budget = :budget, #status = :status, updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#status': 'status'
    };
    const expressionAttributeValues = {
      ':title': title || collaboration.title,
      ':description': description || collaboration.description,
      ':skills': skills || collaboration.skills,
      ':projectType': projectType || collaboration.projectType,
      ':duration': duration || collaboration.duration,
      ':budget': budget || collaboration.budget,
      ':status': status || collaboration.status,
      ':updatedAt': new Date().toISOString()
    };

    const updatedCollaboration = await updateItem(
      COLLABORATIONS_TABLE,
      { collaborationId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Invalidate cache
    await deleteCache(`collaboration:${id}`);
    await deleteCache('collaborations:all:1:20');

    res.json({
      message: 'Collaboration updated successfully',
      collaboration: updatedCollaboration
    });
  } catch (error) {
    console.error('Update collaboration error:', error);
    res.status(500).json({ error: 'Failed to update collaboration' });
  }
});

// DELETE /api/collaborations/:id - Delete collaboration
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const collaboration = await getItem(COLLABORATIONS_TABLE, { collaborationId: id });
    
    if (!collaboration) {
      return res.status(404).json({ error: 'Collaboration not found' });
    }

    if (collaboration.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this collaboration' });
    }

    // Soft delete by setting isActive to false
    const updateExpression = 'SET isActive = :isActive, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':isActive': false,
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      COLLABORATIONS_TABLE,
      { collaborationId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(`collaboration:${id}`);
    await deleteCache('collaborations:all:1:20');

    res.json({ message: 'Collaboration deleted successfully' });
  } catch (error) {
    console.error('Delete collaboration error:', error);
    res.status(500).json({ error: 'Failed to delete collaboration' });
  }
});

module.exports = router;
