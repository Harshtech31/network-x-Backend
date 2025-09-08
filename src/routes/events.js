const express = require('express');
const { Event, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/events
router.get('/', authenticateToken, async (req, res) => {
  try {
    const events = await Event.findAll({
      where: { isPublic: true },
      include: [{
        model: User,
        as: 'organizer',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [['startDate', 'ASC']]
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

module.exports = router;
