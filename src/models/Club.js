module.exports = (sequelize, DataTypes) => {
  const Club = sequelize.define('Club', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [3, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 1000]
      }
    },
    category: {
      type: DataTypes.ENUM('technology', 'business', 'sports', 'academic', 'social', 'arts', 'volunteer'),
      allowNull: false
    },
    clubImage: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    requiresApproval: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    maxMembers: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 1000
      }
    },
    currentMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    rules: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meetingSchedule: {
      type: DataTypes.STRING,
      allowNull: true
    },
    contactInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    tableName: 'clubs',
    indexes: [
      {
        fields: ['creatorId']
      },
      {
        fields: ['category']
      },
      {
        fields: ['isPublic']
      },
      {
        fields: ['isActive']
      }
    ]
  });

  return Club;
};
