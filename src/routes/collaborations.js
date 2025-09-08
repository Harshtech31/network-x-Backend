const express = require('express');
const { Collaboration, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/collaborations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const collaborations = await Collaboration.findAll({
      where: { isActive: true },
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(collaborations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch collaborations' });
  }
});

module.exports = router;
