const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../../server');
const User = require('../models/mongodb/User');

describe('User Routes', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    const MONGODB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/networkx-test';
    await mongoose.connect(MONGODB_URI);
  });

  beforeEach(async () => {
    await User.deleteMany({});
    
    // Create test user
    testUser = new User({
      email: 'test@example.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      department: 'Computer Science',
      year: 3
    });
    await testUser.save();

    // Generate auth token
    authToken = jwt.sign(
      { userId: testUser._id },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.connection.close();
  });

  describe('GET /api/users/profile', () => {
    it('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.email).toBe('test@example.com');
      expect(response.body.firstName).toBe('John');
      expect(response.body.password).toBeUndefined();
    });

    it('should return 401 without auth token', async () => {
      await request(app)
        .get('/api/users/profile')
        .expect(401);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('should update user profile successfully', async () => {
      const updateData = {
        bio: 'Updated bio',
        skills: ['JavaScript', 'Node.js'],
        interests: ['Web Development']
      };

      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.message).toBe('Profile updated successfully');
      expect(response.body.user.bio).toBe('Updated bio');
      expect(response.body.user.skills).toEqual(['JavaScript', 'Node.js']);
    });
  });

  describe('POST /api/users/follow/:userId', () => {
    let targetUser;

    beforeEach(async () => {
      targetUser = new User({
        email: 'target@example.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Smith',
        username: 'janesmith'
      });
      await targetUser.save();
    });

    it('should follow user successfully', async () => {
      const response = await request(app)
        .post(`/api/users/follow/${targetUser._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Followed successfully');
      expect(response.body.isFollowing).toBe(true);

      // Verify in database
      const updatedUser = await User.findById(testUser._id);
      const updatedTarget = await User.findById(targetUser._id);
      
      expect(updatedUser.following).toContain(targetUser._id);
      expect(updatedTarget.followers).toContain(testUser._id);
    });

    it('should unfollow user successfully', async () => {
      // First follow
      await request(app)
        .post(`/api/users/follow/${targetUser._id}`)
        .set('Authorization', `Bearer ${authToken}`);

      // Then unfollow
      const response = await request(app)
        .post(`/api/users/follow/${targetUser._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Unfollowed successfully');
      expect(response.body.isFollowing).toBe(false);
    });

    it('should return error when trying to follow self', async () => {
      const response = await request(app)
        .post(`/api/users/follow/${testUser._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.error).toBe('Cannot follow yourself');
    });
  });

  describe('GET /api/users/search', () => {
    beforeEach(async () => {
      // Create additional test users
      const users = [
        {
          email: 'alice@example.com',
          password: 'password123',
          firstName: 'Alice',
          lastName: 'Johnson',
          username: 'alicejohnson',
          department: 'Computer Science',
          year: 2,
          skills: ['Python', 'Machine Learning']
        },
        {
          email: 'bob@example.com',
          password: 'password123',
          firstName: 'Bob',
          lastName: 'Wilson',
          username: 'bobwilson',
          department: 'Electrical Engineering',
          year: 4,
          skills: ['JavaScript', 'React']
        }
      ];

      await User.insertMany(users);
    });

    it('should search users by query', async () => {
      const response = await request(app)
        .get('/api/users/search?q=Alice')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].firstName).toBe('Alice');
    });

    it('should filter users by department', async () => {
      const response = await request(app)
        .get('/api/users/search?department=Computer Science')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.users.length).toBeGreaterThan(0);
      response.body.users.forEach(user => {
        expect(user.department).toBe('Computer Science');
      });
    });

    it('should filter users by skills', async () => {
      const response = await request(app)
        .get('/api/users/search?skills=JavaScript')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].skills).toContain('JavaScript');
    });
  });
});
