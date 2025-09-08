const express = require('express');
const { Op } = require('sequelize');
const { Message, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/messages
router.get('/', authenticateToken, async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id },
          { receiverId: req.user.id }
        ]
      },
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
        },
        {
          model: User,
          as: 'receiver',
          attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
