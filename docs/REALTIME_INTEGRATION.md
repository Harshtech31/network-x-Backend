# Real-time Integration Guide for Network-X

## Overview

Network-X now includes comprehensive real-time features powered by Socket.IO and Redis. This document provides a complete guide for understanding and using the real-time functionality.

## Architecture

### Backend Components

1. **Socket.IO Server** (`src/config/socket.js`)
   - Handles WebSocket connections
   - Manages user authentication
   - Routes real-time events
   - Maintains user presence

2. **Real-time Service** (`src/services/realtime.js`)
   - Centralized service for real-time operations
   - Handles notifications, messaging, and interactions
   - Integrates with existing API routes

3. **Redis Integration** (`src/config/redis.js`)
   - Caches user presence data
   - Stores temporary real-time state
   - Enables horizontal scaling

### Frontend Components

1. **Socket Service** (`frontend/utils/socket.ts`)
   - TypeScript client for Socket.IO
   - Event management and connection handling
   - Typed interfaces for real-time data

## Features

### 1. Real-time Messaging

**Backend Events:**
- `message:new` - New message in conversation
- `message:read` - Message read receipt
- `typing:start` - User started typing
- `typing:stop` - User stopped typing

**Frontend Usage:**
```typescript
import socketService from '../utils/socket';

// Join a conversation
socketService.joinConversation('conversation-id');

// Send a message
socketService.sendMessage({
  conversationId: 'conversation-id',
  receiverId: 'user-id',
  content: 'Hello!',
  messageType: 'text'
});

// Listen for new messages
socketService.on('message:new', (message) => {
  console.log('New message:', message);
});

// Handle typing indicators
socketService.startTyping('conversation-id');
socketService.stopTyping('conversation-id');
```

### 2. Real-time Notifications

**Notification Types:**
- `message` - New message notifications
- `like` - Post/project likes
- `comment` - Post comments
- `follow` - New followers
- `connection_request` - Connection requests
- `project_application` - Project applications
- `club_join` - Club memberships
- `event_attendance` - Event attendance

**Frontend Usage:**
```typescript
// Listen for notifications
socketService.on('notification:new', (notification) => {
  // Show notification in UI
  showNotification(notification.title, notification.message);
});

// Send custom notification
socketService.sendNotification({
  targetUserId: 'user-id',
  type: 'custom',
  title: 'Custom Notification',
  message: 'This is a custom message',
  data: { customField: 'value' }
});
```

### 3. Post Interactions

**Real-time Events:**
- Post likes/unlikes
- New comments
- Real-time engagement updates

**Frontend Usage:**
```typescript
// Like a post (triggers real-time event)
socketService.likePost({
  postId: 'post-id',
  postOwnerId: 'owner-id',
  liked: true
});

// Listen for post interactions
socketService.on('post:interaction', (interaction) => {
  if (interaction.type === 'like') {
    updatePostLikes(interaction.postId, interaction.liked);
  }
});
```

### 4. User Presence

**Presence States:**
- `online` - User is active
- `away` - User is idle
- `busy` - User is busy
- `offline` - User is offline

**Frontend Usage:**
```typescript
// Update presence
socketService.updatePresence('online');

// Listen for presence changes
socketService.on('presence:update', (presence) => {
  updateUserPresence(presence.userId, presence.status);
});

socketService.on('user:online', (data) => {
  showUserOnline(data.userId);
});

socketService.on('user:offline', (data) => {
  showUserOffline(data.userId, data.lastSeen);
});
```

### 5. Project & Club Interactions

**Real-time Events:**
- Project applications
- Club join requests
- Membership approvals
- Event attendance

**Frontend Usage:**
```typescript
// Apply to project
socketService.applyToProject({
  projectId: 'project-id',
  projectOwnerId: 'owner-id'
});

// Join club
socketService.joinClub({
  clubId: 'club-id',
  clubPresidentId: 'president-id'
});

// Attend event
socketService.attendEvent({
  eventId: 'event-id',
  eventOrganizerId: 'organizer-id',
  attending: true
});
```

## API Endpoints

### Real-time Status
```
GET /api/realtime/status
```
Returns current real-time system status and online user count.

### User Presence
```
GET /api/realtime/presence/:userId
```
Get specific user's presence information.

### Broadcast Announcement
```
POST /api/realtime/broadcast
```
Send system-wide announcements (admin feature).

### Send Notification
```
POST /api/realtime/notification
```
Send custom notifications to specific users.

### Health Check
```
GET /api/realtime/health
```
Health check for real-time services.

## Integration with Existing APIs

All existing API routes now emit real-time events:

### Posts API
- Like/unlike posts → `post:interaction` event
- Add comments → `post:interaction` event
- Notifications sent to post owners

### Projects API
- Apply to projects → Notification to project owner
- Accept applications → Notification to applicant

### Clubs API
- Join clubs → Notification to club president
- Application approvals → Notification to applicant

### Events API
- Attend events → Notification to event organizer
- Register for events → Notification to organizer

### Messages API
- Send messages → Real-time message delivery
- Read receipts → Real-time read status

## Environment Variables

Add these to your `.env` file:

```env
# Frontend URL for CORS (optional)
FRONTEND_URL=http://localhost:3000

# Redis configuration (if different from defaults)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

## Connection Management

### Authentication
Socket.IO connections are authenticated using JWT tokens. The token should be provided in the `auth.token` field during connection.

### Reconnection
The client automatically handles reconnection with exponential backoff:
- Maximum 5 reconnection attempts
- 1-second initial delay
- Automatic retry on connection loss

### Error Handling
```typescript
socketService.on('socket:error', (error) => {
  console.error('Socket error:', error);
  // Handle connection errors
});

socketService.on('socket:disconnected', (reason) => {
  console.log('Disconnected:', reason);
  // Handle disconnection
});
```

## Best Practices

### 1. Connection Lifecycle
- Connect when user logs in
- Disconnect when user logs out
- Handle app state changes (background/foreground)

### 2. Event Listeners
- Always clean up event listeners
- Use specific event names to avoid conflicts
- Handle errors in event callbacks

### 3. Performance
- Join only necessary conversation rooms
- Limit real-time updates to visible UI components
- Use throttling for high-frequency events (typing indicators)

### 4. Error Handling
- Always handle connection errors gracefully
- Provide fallback for offline scenarios
- Show connection status to users

## Testing

### Manual Testing
1. Open multiple browser tabs/devices
2. Login with different users
3. Test messaging, notifications, and interactions
4. Verify real-time updates across clients

### Automated Testing
```javascript
// Example test for real-time messaging
describe('Real-time Messaging', () => {
  it('should deliver messages in real-time', (done) => {
    const client1 = io('http://localhost:5000', { auth: { token: token1 } });
    const client2 = io('http://localhost:5000', { auth: { token: token2 } });
    
    client2.on('message:new', (message) => {
      expect(message.content).toBe('Test message');
      done();
    });
    
    client1.emit('message:send', {
      conversationId: 'test-conversation',
      receiverId: 'user2',
      content: 'Test message'
    });
  });
});
```

## Troubleshooting

### Common Issues

1. **Connection Fails**
   - Check JWT token validity
   - Verify server is running
   - Check CORS configuration

2. **Events Not Received**
   - Ensure proper room joining
   - Check event listener setup
   - Verify user authentication

3. **Performance Issues**
   - Monitor Redis memory usage
   - Check for memory leaks in event listeners
   - Optimize database queries in real-time handlers

### Debug Mode
Enable debug logging:
```typescript
// Client-side
localStorage.debug = 'socket.io-client:socket';

// Server-side
DEBUG=socket.io:* node server.js
```

## Future Enhancements

1. **Push Notifications**
   - Integration with Firebase/APNs
   - Offline notification delivery

2. **Advanced Presence**
   - Location-based presence
   - Activity status (studying, working, etc.)

3. **Real-time Collaboration**
   - Document editing
   - Shared whiteboards
   - Video/voice calls

4. **Analytics**
   - Real-time engagement metrics
   - User activity tracking
   - Performance monitoring

## Support

For issues or questions about real-time features:
1. Check this documentation
2. Review server logs
3. Test connection with debug mode
4. Contact the development team

---

*This documentation covers the complete real-time integration for Network-X. Keep it updated as new features are added.*
