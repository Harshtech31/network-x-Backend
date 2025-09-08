const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../config/aws');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS, invalidateProjectCache } = require('../config/redis');
const User = require('../models/mongodb/User');
const RealtimeService = require('../services/realtime');

const router = express.Router();
const PROJECTS_TABLE = process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects';

// GET /api/projects - Get all projects with pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, status } = req.query;
    const cacheKey = `projects:all:${page}:${limit}:${category || 'all'}:${status || 'all'}`;
    
    // Try cache first
    const cachedProjects = await getCache(cacheKey);
    if (cachedProjects) {
      return res.json(cachedProjects);
    }

    // Get projects from DynamoDB
    let projects = await scanItems(PROJECTS_TABLE, null, {}, parseInt(limit));
    
    // Apply filters
    if (category) {
      projects = projects.filter(project => project.category === category);
    }
    if (status) {
      projects = projects.filter(project => project.status === status);
    }
    
    // Get user details for each project
    const projectsWithUsers = await Promise.all(
      projects.map(async (project) => {
        const user = await User.findById(project.ownerId).select('firstName lastName username profileImage');
        return {
          ...project,
          owner: user
        };
      })
    );

    // Sort by creation date (newest first)
    projectsWithUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const result = {
      projects: projectsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: projectsWithUsers.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST /api/projects - Create new project
router.post('/', authenticateToken, uploadMiddleware.projectMedia, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      category, 
      skillsRequired, 
      teamSize, 
      duration, 
      status = 'recruiting',
      visibility = 'public'
    } = req.body;
    const projectId = uuidv4();
    
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Project title is required' });
    }
    
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: 'Project description is required' });
    }

    const mediaUrls = req.files ? req.files.map(file => file.location) : [];
    
    const project = {
      projectId,
      ownerId: req.user.id,
      title: title.trim(),
      description: description.trim(),
      category: category || 'other',
      skillsRequired: skillsRequired ? skillsRequired.split(',').map(skill => skill.trim()) : [],
      teamSize: parseInt(teamSize) || 1,
      duration: duration || null,
      status,
      visibility,
      mediaUrls,
      members: [req.user.id],
      memberCount: 1,
      applications: [],
      applicationCount: 0,
      likes: 0,
      likedBy: [],
      views: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(PROJECTS_TABLE, project);

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseProject = {
      ...project,
      owner: user
    };

    // Invalidate cache
    await invalidateProjectCache(projectId, req.user.id);

    res.status(201).json({
      message: 'Project created successfully',
      project: responseProject
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:id - Get specific project
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.PROJECT_DETAILS(id);
    
    // Try cache first
    const cachedProject = await getCache(cacheKey);
    if (cachedProject) {
      return res.json(cachedProject);
    }

    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Increment view count
    await updateItem(
      PROJECTS_TABLE,
      { projectId: id },
      'SET #views = #views + :inc',
      { ':inc': 1 },
      { '#views': 'views' }
    );

    // Get user details
    const user = await User.findById(project.ownerId).select('firstName lastName username profileImage');
    
    const responseProject = {
      ...project,
      views: project.views + 1,
      owner: user
    };

    // Cache for 10 minutes
    await setCache(cacheKey, responseProject, 600);
    
    res.json(responseProject);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// PUT /api/projects/:id - Update project
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, skillsRequired, teamSize, duration, status, visibility } = req.body;
    
    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this project' });
    }

    const updateExpression = 'SET #title = :title, #description = :description, #category = :category, #skillsRequired = :skillsRequired, #teamSize = :teamSize, #duration = :duration, #status = :status, #visibility = :visibility, #updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#title': 'title',
      '#description': 'description',
      '#category': 'category',
      '#skillsRequired': 'skillsRequired',
      '#teamSize': 'teamSize',
      '#duration': 'duration',
      '#status': 'status',
      '#visibility': 'visibility',
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues = {
      ':title': title?.trim() || project.title,
      ':description': description?.trim() || project.description,
      ':category': category || project.category,
      ':skillsRequired': skillsRequired ? skillsRequired.split(',').map(skill => skill.trim()) : project.skillsRequired,
      ':teamSize': teamSize ? parseInt(teamSize) : project.teamSize,
      ':duration': duration || project.duration,
      ':status': status || project.status,
      ':visibility': visibility || project.visibility,
      ':updatedAt': new Date().toISOString()
    };

    const updatedProject = await updateItem(
      PROJECTS_TABLE,
      { projectId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseProject = {
      ...updatedProject,
      owner: user
    };

    // Invalidate cache
    await invalidateProjectCache(id, req.user.id);

    res.json({
      message: 'Project updated successfully',
      project: responseProject
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this project' });
    }

    await deleteItem(PROJECTS_TABLE, { projectId: id });

    // Invalidate cache
    await invalidateProjectCache(id, req.user.id);

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// POST /api/projects/:id/like - Like/unlike project
router.post('/:id/like', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const likedBy = project.likedBy || [];
    const isLiked = likedBy.includes(userId);
    
    let updateExpression, expressionAttributeValues;
    
    if (isLiked) {
      // Unlike
      const newLikedBy = likedBy.filter(id => id !== userId);
      updateExpression = 'SET likedBy = :likedBy, likes = :likes, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':likedBy': newLikedBy,
        ':likes': Math.max(0, project.likes - 1),
        ':updatedAt': new Date().toISOString()
      };
    } else {
      // Like
      const newLikedBy = [...likedBy, userId];
      updateExpression = 'SET likedBy = :likedBy, likes = :likes, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':likedBy': newLikedBy,
        ':likes': project.likes + 1,
        ':updatedAt': new Date().toISOString()
      };
    }

    const updatedProject = await updateItem(
      PROJECTS_TABLE,
      { projectId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.PROJECT_DETAILS(id));

    res.json({
      message: isLiked ? 'Project unliked' : 'Project liked',
      liked: !isLiked,
      likes: updatedProject.likes
    });
  } catch (error) {
    console.error('Like project error:', error);
    res.status(500).json({ error: 'Failed to like/unlike project' });
  }
});

// POST /api/projects/:id/apply - Apply to join project
router.post('/:id/apply', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    
    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId === userId) {
      return res.status(400).json({ error: 'Cannot apply to your own project' });
    }

    if (project.members && project.members.includes(userId)) {
      return res.status(400).json({ error: 'Already a member of this project' });
    }

    const applications = project.applications || [];
    const existingApplication = applications.find(app => app.userId === userId);
    
    if (existingApplication) {
      return res.status(400).json({ error: 'Already applied to this project' });
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
      PROJECTS_TABLE,
      { projectId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.PROJECT_DETAILS(id));

    // Send real-time notification
    await RealtimeService.handleProjectInteraction(
      id, 
      project.ownerId, 
      'apply', 
      req.user
    );

    res.status(201).json({
      message: 'Application submitted successfully',
      application
    });
  } catch (error) {
    console.error('Apply to project error:', error);
    res.status(500).json({ error: 'Failed to apply to project' });
  }
});

// PUT /api/projects/:id/applications/:applicationId - Accept/reject application
router.put('/:id/applications/:applicationId', authenticateToken, async (req, res) => {
  try {
    const { id, applicationId } = req.params;
    const { status } = req.body; // 'accepted' or 'rejected'
    
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected' });
    }

    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to manage applications for this project' });
    }

    const applications = project.applications || [];
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
      const members = project.members || [];
      const applicantId = applications[applicationIndex].userId;
      
      if (!members.includes(applicantId)) {
        members.push(applicantId);
        updateExpression += ', members = :members, memberCount = :memberCount';
        expressionAttributeValues[':members'] = members;
        expressionAttributeValues[':memberCount'] = members.length;
      }
    }

    await updateItem(
      PROJECTS_TABLE,
      { projectId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.PROJECT_DETAILS(id));
    await deleteCache(CACHE_KEYS.PROJECT_MEMBERS(id));

    // Send real-time notification for accepted applications
    if (status === 'accepted') {
      await RealtimeService.handleProjectInteraction(
        id, 
        project.ownerId, 
        'accept_application', 
        req.user,
        { applicantId: applications[applicationIndex].userId }
      );
    }

    res.json({
      message: `Application ${status} successfully`,
      application: applications[applicationIndex]
    });
  } catch (error) {
    console.error('Update application error:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// GET /api/projects/:id/members - Get project members
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.PROJECT_MEMBERS(id);
    
    // Try cache first
    const cachedMembers = await getCache(cacheKey);
    if (cachedMembers) {
      return res.json(cachedMembers);
    }

    const project = await getItem(PROJECTS_TABLE, { projectId: id });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const memberIds = project.members || [];
    
    // Get user details for each member
    const members = await Promise.all(
      memberIds.map(async (memberId) => {
        const user = await User.findById(memberId).select('firstName lastName username profileImage bio skills');
        return user;
      })
    );

    const result = {
      members: members.filter(member => member !== null),
      total: members.length
    };

    // Cache for 15 minutes
    await setCache(cacheKey, result, 900);
    
    res.json(result);
  } catch (error) {
    console.error('Get project members error:', error);
    res.status(500).json({ error: 'Failed to fetch project members' });
  }
});

// GET /api/projects/user/:userId - Get user projects
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = `projects:user:${userId}:${page}:${limit}`;
    
    // Try cache first
    const cachedProjects = await getCache(cacheKey);
    if (cachedProjects) {
      return res.json(cachedProjects);
    }

    const projects = await queryItems(
      PROJECTS_TABLE,
      'ownerId = :ownerId',
      { ':ownerId': userId },
      'OwnerProjectsIndex',
      parseInt(limit)
    );

    // Get user details
    const user = await User.findById(userId).select('firstName lastName username profileImage');
    
    const projectsWithUser = projects.map(project => ({
      ...project,
      owner: user
    }));

    const result = {
      projects: projectsWithUser,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: projectsWithUser.length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, result, 600);
    
    res.json(result);
  } catch (error) {
    console.error('Get user projects error:', error);
    res.status(500).json({ error: 'Failed to fetch user projects' });
  }
});

module.exports = router;
