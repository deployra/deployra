package models

import (
	"database/sql/driver"
	"encoding/json"
)

// JSON type for GORM
type JSON json.RawMessage

func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return []byte(j), nil
}

func (j *JSON) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	*j = JSON(bytes)
	return nil
}

// UnmarshalTo unmarshals JSON data to target, handling double-encoded legacy data
func (j JSON) UnmarshalTo(target interface{}) error {
	if j == nil || len(j) == 0 {
		return nil
	}
	// Try direct parse first
	if err := json.Unmarshal(j, target); err != nil {
		// If failed, try to parse as double-encoded string (legacy data)
		var jsonStr string
		if json.Unmarshal(j, &jsonStr) == nil {
			return json.Unmarshal([]byte(jsonStr), target)
		}
		return err
	}
	return nil
}
