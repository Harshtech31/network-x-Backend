module.exports = (sequelize, DataTypes) => {
  const EventRegistration = sequelize.define('EventRegistration', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    status: {
      type: DataTypes.ENUM('registered', 'attended', 'cancelled', 'waitlisted'),
      defaultValue: 'registered'
    },
    registrationDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    checkInTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    additionalInfo: {
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
    eventId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'events',
        key: 'id'
      }
    }
  }, {
    tableName: 'event_registrations',
    indexes: [
      {
        unique: true,
        fields: ['userId', 'eventId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['registrationDate']
      }
    ]
  });

  return EventRegistration;
};
