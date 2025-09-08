module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    type: {
      type: DataTypes.ENUM(
        'connection_request',
        'connection_accepted',
        'event_invitation',
        'event_reminder',
        'new_message',
        'post_comment',
        'post_like',
        'project_invitation',
        'collaboration_invitation',
        'club_invitation',
        'mention',
        'system_alert',
        'new_follower'
      ),
      allowNull: false
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [3, 200]
      }
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    tableName: 'notifications',
    indexes: [
      {
        fields: ['userId']
      },
      {
        fields: ['senderId']
      },
      {
        fields: ['isRead']
      },
      {
        fields: ['createdAt']
      }
    ]
  });

  return Notification;
};
