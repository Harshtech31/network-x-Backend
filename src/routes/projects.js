const express = require('express');
const { Project, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/projects
router.get('/', authenticateToken, async (req, res) => {
  try {
    const projects = await Project.findAll({
      where: { isPublic: true },
      include: [{
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

module.exports = router;
