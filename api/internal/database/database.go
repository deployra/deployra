package database

import (
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

var (
	db   *gorm.DB
	once sync.Once
)

// Connect initializes the database connection
func Connect(dsn string) error {
	var err error
	once.Do(func() {
		newLogger := logger.New(
			log.New(os.Stdout, "\r\n", log.LstdFlags),
			logger.Config{
				SlowThreshold:             200 * time.Millisecond,
				LogLevel:                  logger.Info,
				IgnoreRecordNotFoundError: false,
				Colorful:                  true,
			},
		)

		db, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: newLogger,
			NamingStrategy: schema.NamingStrategy{
				SingularTable: true,
				NoLowerCase:   true,
			},
		})
		if err != nil {
			err = fmt.Errorf("failed to connect to database: %w", err)
			return
		}

		sqlDB, dbErr := db.DB()
		if dbErr != nil {
			err = fmt.Errorf("failed to get database instance: %w", dbErr)
			return
		}

		// Connection pool settings
		sqlDB.SetMaxIdleConns(10)
		sqlDB.SetMaxOpenConns(100)
		sqlDB.SetConnMaxLifetime(5 * time.Minute)
		sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	})
	return err
}

// GetDatabase returns the database instance
func GetDatabase() *gorm.DB {
	return db
}

// SetDatabase sets the database instance (for testing purposes only)
func SetDatabase(database *gorm.DB) {
	db = database
}
