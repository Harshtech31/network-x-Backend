const { getSocketIO, sendNotificationToUser, sendMessageToConversation, isUserOnline } = require('../config/socket');
const { createNotification } = require('../routes/notifications');

/**
 * Real-time service for handling Socket.IO events and notifications
 */
class RealtimeService {
  
  /**
   * Send a real-time notification to a user
   */
  static async sendNotification(userId, notification) {
    try {
      // Create notification in database
      const dbNotification = await createNotification({
        userId,
        senderId: notification.senderId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data || {}
      });

      // Send real-time notification if user is online
      if (isUserOnline(userId)) {
        sendNotificationToUser(userId, {
          ...notification,
          id: dbNotification.id,
          createdAt: dbNotification.createdAt
        });
        return { sent: true, stored: true };
      }

      return { sent: false, stored: true };
    } catch (error) {
      console.error('Send notification error:', error);
      return { sent: false, stored: false, error: error.message };
    }
  }

  /**
   * Broadcast a message to a conversation
   */
  static sendMessageToConversation(conversationId, message) {
    try {
      sendMessageToConversation(conversationId, message);
      return { sent: true };
    } catch (error) {
      console.error('Send message to conversation error:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Handle post interactions (likes, comments)
   */
  static async handlePostInteraction(postId, postOwnerId, interactionType, user, data = {}) {
    const io = getSocketIO();
    if (!io) return;

    try {
      switch (interactionType) {
        case 'like':
          // Notify post owner
          if (postOwnerId !== user.id && isUserOnline(postOwnerId)) {
            await this.sendNotification(postOwnerId, {
              senderId: user.id,
              type: 'like',
              title: data.liked ? 'New Like' : 'Like Removed',
              message: `${user.firstName} ${data.liked ? 'liked' : 'unliked'} your post`,
              data: { postId, userId: user.id, liked: data.liked }
            });
          }

          // Broadcast to all connected users
          io.emit('post:interaction', {
            type: 'like',
            postId,
            userId: user.id,
            liked: data.liked,
            user: {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              username: user.username,
              profileImage: user.profileImage
            }
          });
          break;

        case 'comment':
          // Notify post owner
          if (postOwnerId !== user.id && isUserOnline(postOwnerId)) {
            await this.sendNotification(postOwnerId, {
              senderId: user.id,
              type: 'comment',
              title: 'New Comment',
              message: `${user.firstName} commented on your post`,
              data: { postId, userId: user.id, comment: data.comment }
            });
          }

          // Broadcast comment to all users
          io.emit('post:interaction', {
            type: 'comment',
            postId,
            userId: user.id,
            comment: data.comment,
            user: {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              username: user.username,
              profileImage: user.profileImage
            }
          });
          break;
      }
    } catch (error) {
      console.error('Handle post interaction error:', error);
    }
  }

  /**
   * Handle project interactions
   */
  static async handleProjectInteraction(projectId, projectOwnerId, interactionType, user, data = {}) {
    try {
      switch (interactionType) {
        case 'apply':
          if (isUserOnline(projectOwnerId)) {
            await this.sendNotification(projectOwnerId, {
              senderId: user.id,
              type: 'project_application',
              title: 'New Project Application',
              message: `${user.firstName} applied to join your project`,
              data: { projectId, applicantId: user.id }
            });
          }
          break;

        case 'invite':
          if (data.inviteeId && isUserOnline(data.inviteeId)) {
            await this.sendNotification(data.inviteeId, {
              senderId: user.id,
              type: 'project_invite',
              title: 'Project Invitation',
              message: `${user.firstName} invited you to join a project`,
              data: { projectId, inviterId: user.id }
            });
          }
          break;

        case 'accept_application':
          if (data.applicantId && isUserOnline(data.applicantId)) {
            await this.sendNotification(data.applicantId, {
              senderId: user.id,
              type: 'project_accepted',
              title: 'Application Accepted',
              message: `Your application to join the project was accepted`,
              data: { projectId, acceptedBy: user.id }
            });
          }
          break;

        case 'like':
          if (projectOwnerId !== user.id && isUserOnline(projectOwnerId)) {
            await this.sendNotification(projectOwnerId, {
              senderId: user.id,
              type: 'project_like',
              title: data.liked ? 'Project Liked' : 'Project Unliked',
              message: `${user.firstName} ${data.liked ? 'liked' : 'unliked'} your project`,
              data: { projectId, userId: user.id, liked: data.liked }
            });
          }
          break;
      }
    } catch (error) {
      console.error('Handle project interaction error:', error);
    }
  }

  /**
   * Handle club interactions
   */
  static async handleClubInteraction(clubId, clubOwnerId, interactionType, user, data = {}) {
    try {
      switch (interactionType) {
        case 'join':
          if (isUserOnline(clubOwnerId)) {
            await this.sendNotification(clubOwnerId, {
              senderId: user.id,
              type: 'club_join',
              title: 'New Club Member',
              message: `${user.firstName} joined your club`,
              data: { clubId, memberId: user.id }
            });
          }
          break;

        case 'apply':
          if (isUserOnline(clubOwnerId)) {
            await this.sendNotification(clubOwnerId, {
              senderId: user.id,
              type: 'club_application',
              title: 'New Club Application',
              message: `${user.firstName} applied to join your club`,
              data: { clubId, applicantId: user.id }
            });
          }
          break;

        case 'accept_application':
          if (data.applicantId && isUserOnline(data.applicantId)) {
            await this.sendNotification(data.applicantId, {
              senderId: user.id,
              type: 'club_accepted',
              title: 'Club Application Accepted',
              message: `Your application to join the club was accepted`,
              data: { clubId, acceptedBy: user.id }
            });
          }
          break;
      }
    } catch (error) {
      console.error('Handle club interaction error:', error);
    }
  }

  /**
   * Handle event interactions
   */
  static async handleEventInteraction(eventId, eventOrganizerId, interactionType, user, data = {}) {
    try {
      switch (interactionType) {
        case 'attend':
          if (eventOrganizerId !== user.id && isUserOnline(eventOrganizerId)) {
            await this.sendNotification(eventOrganizerId, {
              senderId: user.id,
              type: 'event_attendance',
              title: data.attending ? 'New Event Attendee' : 'Event Attendance Cancelled',
              message: `${user.firstName} ${data.attending ? 'will attend' : 'cancelled attendance for'} your event`,
              data: { eventId, attendeeId: user.id, attending: data.attending }
            });
          }
          break;

        case 'register':
          if (eventOrganizerId !== user.id && isUserOnline(eventOrganizerId)) {
            await this.sendNotification(eventOrganizerId, {
              senderId: user.id,
              type: 'event_registration',
              title: 'New Event Registration',
              message: `${user.firstName} registered for your event`,
              data: { eventId, registrantId: user.id }
            });
          }
          break;
      }
    } catch (error) {
      console.error('Handle event interaction error:', error);
    }
  }

  /**
   * Handle user interactions (follow, connect)
   */
  static async handleUserInteraction(targetUserId, interactionType, user, data = {}) {
    try {
      switch (interactionType) {
        case 'follow':
          if (isUserOnline(targetUserId)) {
            await this.sendNotification(targetUserId, {
              senderId: user.id,
              type: 'follow',
              title: 'New Follower',
              message: `${user.firstName} started following you`,
              data: { followerId: user.id }
            });
          }
          break;

        case 'unfollow':
          // Usually no notification for unfollow
          break;

        case 'connect':
          if (isUserOnline(targetUserId)) {
            await this.sendNotification(targetUserId, {
              senderId: user.id,
              type: 'connection_request',
              title: 'Connection Request',
              message: `${user.firstName} wants to connect with you`,
              data: { requesterId: user.id }
            });
          }
          break;

        case 'accept_connection':
          if (isUserOnline(targetUserId)) {
            await this.sendNotification(targetUserId, {
              senderId: user.id,
              type: 'connection_accepted',
              title: 'Connection Accepted',
              message: `${user.firstName} accepted your connection request`,
              data: { acceptedBy: user.id }
            });
          }
          break;
      }
    } catch (error) {
      console.error('Handle user interaction error:', error);
    }
  }

  /**
   * Handle message interactions
   */
  static async handleMessageInteraction(conversationId, interactionType, user, data = {}) {
    try {
      switch (interactionType) {
        case 'new_message':
          // Send to conversation room
          this.sendMessageToConversation(conversationId, {
            conversationId,
            senderId: user.id,
            receiverId: data.receiverId,
            content: data.content,
            messageType: data.messageType || 'text',
            timestamp: new Date().toISOString(),
            sender: {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              username: user.username,
              profileImage: user.profileImage
            }
          });

          // Send notification to receiver if online
          if (data.receiverId && isUserOnline(data.receiverId)) {
            await this.sendNotification(data.receiverId, {
              senderId: user.id,
              type: 'message',
              title: 'New Message',
              message: `${user.firstName} sent you a message`,
              data: { conversationId, senderId: user.id }
            });
          }
          break;

        case 'message_read':
          const io = getSocketIO();
          if (io && data.senderId && isUserOnline(data.senderId)) {
            io.to(`user:${data.senderId}`).emit('message:read', {
              conversationId,
              messageId: data.messageId,
              readBy: user.id,
              readAt: new Date().toISOString()
            });
          }
          break;
      }
    } catch (error) {
      console.error('Handle message interaction error:', error);
    }
  }

  /**
   * Broadcast system-wide announcements
   */
  static broadcastAnnouncement(announcement) {
    const io = getSocketIO();
    if (io) {
      io.emit('system:announcement', {
        ...announcement,
        timestamp: new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  /**
   * Get online users count
   */
  static getOnlineUsersCount() {
    const io = getSocketIO();
    if (io) {
      return io.engine.clientsCount;
    }
    return 0;
  }

  /**
   * Check if user is online
   */
  static isUserOnline(userId) {
    return isUserOnline(userId);
  }
}

module.exports = RealtimeService;
