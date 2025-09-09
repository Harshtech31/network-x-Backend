const AWS = require('aws-sdk');

// Configure AWS SNS
const sns = new AWS.SNS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Create platform endpoint for push notifications
 * @param {string} platformApplicationArn - SNS platform application ARN
 * @param {string} token - Device token from mobile app
 * @param {Object} userData - Optional user data
 * @returns {Promise<Object>} SNS response with endpoint ARN
 */
const createPlatformEndpoint = async (platformApplicationArn, token, userData = {}) => {
  const params = {
    PlatformApplicationArn: platformApplicationArn,
    Token: token,
    CustomUserData: JSON.stringify(userData)
  };

  try {
    const result = await sns.createPlatformEndpoint(params).promise();
    console.log('Platform endpoint created:', result.EndpointArn);
    return result;
  } catch (error) {
    console.error('SNS create endpoint error:', error);
    throw error;
  }
};

/**
 * Send push notification to specific endpoint
 * @param {string} endpointArn - SNS endpoint ARN
 * @param {Object} message - Notification message
 * @param {string} message.title - Notification title
 * @param {string} message.body - Notification body
 * @param {Object} message.data - Additional data payload
 * @param {string} platform - Platform type (ios, android)
 * @returns {Promise<Object>} SNS response
 */
const sendPushNotification = async (endpointArn, message, platform = 'android') => {
  const { title, body, data = {} } = message;
  
  let messagePayload;
  
  if (platform.toLowerCase() === 'ios') {
    // iOS APNS format
    messagePayload = {
      APNS: JSON.stringify({
        aps: {
          alert: {
            title,
            body
          },
          badge: data.badge || 1,
          sound: data.sound || 'default'
        },
        data
      })
    };
  } else {
    // Android FCM format
    messagePayload = {
      GCM: JSON.stringify({
        notification: {
          title,
          body,
          icon: data.icon || 'ic_notification',
          color: data.color || '#667eea',
          sound: data.sound || 'default'
        },
        data: {
          ...data,
          click_action: data.clickAction || 'FLUTTER_NOTIFICATION_CLICK'
        }
      })
    };
  }

  const params = {
    TargetArn: endpointArn,
    Message: JSON.stringify(messagePayload),
    MessageStructure: 'json'
  };

  try {
    const result = await sns.publish(params).promise();
    console.log('Push notification sent:', result.MessageId);
    return result;
  } catch (error) {
    console.error('SNS push notification error:', error);
    throw error;
  }
};

/**
 * Send push notification to topic (broadcast)
 * @param {string} topicArn - SNS topic ARN
 * @param {Object} message - Notification message
 * @param {string} message.title - Notification title
 * @param {string} message.body - Notification body
 * @param {Object} message.data - Additional data payload
 * @returns {Promise<Object>} SNS response
 */
const sendTopicNotification = async (topicArn, message) => {
  const { title, body, data = {} } = message;
  
  const messagePayload = {
    default: body,
    GCM: JSON.stringify({
      notification: {
        title,
        body,
        icon: data.icon || 'ic_notification',
        color: data.color || '#667eea'
      },
      data
    }),
    APNS: JSON.stringify({
      aps: {
        alert: {
          title,
          body
        },
        badge: data.badge || 1,
        sound: data.sound || 'default'
      },
      data
    })
  };

  const params = {
    TopicArn: topicArn,
    Message: JSON.stringify(messagePayload),
    MessageStructure: 'json',
    Subject: title
  };

  try {
    const result = await sns.publish(params).promise();
    console.log('Topic notification sent:', result.MessageId);
    return result;
  } catch (error) {
    console.error('SNS topic notification error:', error);
    throw error;
  }
};

/**
 * Subscribe endpoint to topic
 * @param {string} topicArn - SNS topic ARN
 * @param {string} endpointArn - SNS endpoint ARN
 * @returns {Promise<Object>} SNS response
 */
const subscribeEndpointToTopic = async (topicArn, endpointArn) => {
  const params = {
    TopicArn: topicArn,
    Protocol: 'application',
    Endpoint: endpointArn
  };

  try {
    const result = await sns.subscribe(params).promise();
    console.log('Endpoint subscribed to topic:', result.SubscriptionArn);
    return result;
  } catch (error) {
    console.error('SNS subscribe error:', error);
    throw error;
  }
};

/**
 * Unsubscribe endpoint from topic
 * @param {string} subscriptionArn - SNS subscription ARN
 * @returns {Promise<Object>} SNS response
 */
const unsubscribeFromTopic = async (subscriptionArn) => {
  const params = {
    SubscriptionArn: subscriptionArn
  };

  try {
    const result = await sns.unsubscribe(params).promise();
    console.log('Unsubscribed from topic:', subscriptionArn);
    return result;
  } catch (error) {
    console.error('SNS unsubscribe error:', error);
    throw error;
  }
};

/**
 * Delete platform endpoint
 * @param {string} endpointArn - SNS endpoint ARN
 * @returns {Promise<Object>} SNS response
 */
const deletePlatformEndpoint = async (endpointArn) => {
  const params = {
    EndpointArn: endpointArn
  };

  try {
    const result = await sns.deleteEndpoint(params).promise();
    console.log('Platform endpoint deleted:', endpointArn);
    return result;
  } catch (error) {
    console.error('SNS delete endpoint error:', error);
    throw error;
  }
};

/**
 * Get endpoint attributes
 * @param {string} endpointArn - SNS endpoint ARN
 * @returns {Promise<Object>} Endpoint attributes
 */
const getEndpointAttributes = async (endpointArn) => {
  const params = {
    EndpointArn: endpointArn
  };

  try {
    const result = await sns.getEndpointAttributes(params).promise();
    return result.Attributes;
  } catch (error) {
    console.error('SNS get endpoint attributes error:', error);
    throw error;
  }
};

/**
 * Update endpoint attributes
 * @param {string} endpointArn - SNS endpoint ARN
 * @param {Object} attributes - Attributes to update
 * @returns {Promise<Object>} SNS response
 */
const setEndpointAttributes = async (endpointArn, attributes) => {
  const params = {
    EndpointArn: endpointArn,
    Attributes: attributes
  };

  try {
    const result = await sns.setEndpointAttributes(params).promise();
    console.log('Endpoint attributes updated:', endpointArn);
    return result;
  } catch (error) {
    console.error('SNS set endpoint attributes error:', error);
    throw error;
  }
};

/**
 * Create SNS topic
 * @param {string} topicName - Topic name
 * @returns {Promise<Object>} SNS response with topic ARN
 */
const createTopic = async (topicName) => {
  const params = {
    Name: topicName
  };

  try {
    const result = await sns.createTopic(params).promise();
    console.log('Topic created:', result.TopicArn);
    return result;
  } catch (error) {
    console.error('SNS create topic error:', error);
    throw error;
  }
};

/**
 * List platform applications
 * @returns {Promise<Array>} List of platform applications
 */
const listPlatformApplications = async () => {
  try {
    const result = await sns.listPlatformApplications().promise();
    return result.PlatformApplications;
  } catch (error) {
    console.error('SNS list platform applications error:', error);
    throw error;
  }
};

/**
 * Check if SNS is properly configured
 * @returns {Promise<boolean>} Configuration status
 */
const checkSNSConfiguration = async () => {
  try {
    await sns.listTopics().promise();
    console.log('SNS configuration is valid');
    return true;
  } catch (error) {
    console.error('SNS configuration error:', error);
    return false;
  }
};

/**
 * Send bulk push notifications
 * @param {Array<string>} endpointArns - Array of endpoint ARNs
 * @param {Object} message - Notification message
 * @param {string} platform - Platform type
 * @returns {Promise<Array>} Array of results
 */
const sendBulkPushNotifications = async (endpointArns, message, platform = 'android') => {
  const results = [];
  
  for (const endpointArn of endpointArns) {
    try {
      const result = await sendPushNotification(endpointArn, message, platform);
      results.push({ endpointArn, success: true, messageId: result.MessageId });
    } catch (error) {
      console.error(`Bulk push notification error for ${endpointArn}:`, error);
      results.push({ endpointArn, success: false, error: error.message });
    }
  }

  return results;
};

// Notification templates for common push notifications
const PUSH_TEMPLATES = {
  NEW_MESSAGE: {
    title: 'New Message',
    body: '{{senderName}} sent you a message',
    data: {
      type: 'message',
      clickAction: 'OPEN_CHAT'
    }
  },
  
  NEW_FOLLOWER: {
    title: 'New Follower',
    body: '{{followerName}} started following you',
    data: {
      type: 'follower',
      clickAction: 'OPEN_PROFILE'
    }
  },
  
  PROJECT_INVITATION: {
    title: 'Project Invitation',
    body: '{{inviterName}} invited you to join "{{projectTitle}}"',
    data: {
      type: 'project_invitation',
      clickAction: 'OPEN_PROJECT'
    }
  },
  
  EVENT_REMINDER: {
    title: 'Event Reminder',
    body: '"{{eventTitle}}" starts in {{timeUntil}}',
    data: {
      type: 'event_reminder',
      clickAction: 'OPEN_EVENT'
    }
  },
  
  POST_LIKE: {
    title: 'New Like',
    body: '{{likerName}} liked your post',
    data: {
      type: 'post_like',
      clickAction: 'OPEN_POST'
    }
  },
  
  COMMENT_REPLY: {
    title: 'New Reply',
    body: '{{replierName}} replied to your comment',
    data: {
      type: 'comment_reply',
      clickAction: 'OPEN_POST'
    }
  }
};

module.exports = {
  createPlatformEndpoint,
  sendPushNotification,
  sendTopicNotification,
  subscribeEndpointToTopic,
  unsubscribeFromTopic,
  deletePlatformEndpoint,
  getEndpointAttributes,
  setEndpointAttributes,
  createTopic,
  listPlatformApplications,
  checkSNSConfiguration,
  sendBulkPushNotifications,
  PUSH_TEMPLATES
};
