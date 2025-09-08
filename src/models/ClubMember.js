module.exports = (sequelize, DataTypes) => {
  const ClubMember = sequelize.define('ClubMember', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    role: {
      type: DataTypes.ENUM('admin', 'moderator', 'member'),
      defaultValue: 'member'
    },
    joinDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('active', 'pending', 'suspended', 'banned'),
      defaultValue: 'pending'
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
    clubId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'clubs',
        key: 'id'
      }
    }
  }, {
    tableName: 'club_members',
    indexes: [
      {
        unique: true,
        fields: ['userId', 'clubId']
      },
      {
        fields: ['role']
      },
      {
        fields: ['status']
      }
    ]
  });

  return ClubMember;
};
