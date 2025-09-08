const express = require('express');
const { Club, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/clubs
router.get('/', authenticateToken, async (req, res) => {
  try {
    const clubs = await Club.findAll({
      where: { isActive: true },
      include: [{
        model: User,
        as: 'president',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [['memberCount', 'DESC']]
    });
    res.json(clubs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clubs' });
  }
});

module.exports = router;
