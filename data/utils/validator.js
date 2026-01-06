/**
 * Validation utilities for common data types.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_MIN_LENGTH = 8;

/**
 * Validation result object.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the validation passed
 * @property {string[]} errors - Array of error messages
 */

/**
 * Validate an email address.
 * @param {string} email - The email to validate
 * @returns {ValidationResult}
 */
function validateEmail(email) {
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  } else if (typeof email !== 'string') {
    errors.push('Email must be a string');
  } else if (!EMAIL_REGEX.test(email)) {
    errors.push('Invalid email format');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a username.
 * @param {string} username - The username to validate
 * @returns {ValidationResult}
 */
function validateUsername(username) {
  const errors = [];

  if (!username) {
    errors.push('Username is required');
  } else if (typeof username !== 'string') {
    errors.push('Username must be a string');
  } else if (!USERNAME_REGEX.test(username)) {
    errors.push('Username must be 3-20 characters and contain only letters, numbers, and underscores');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a password.
 * @param {string} password - The password to validate
 * @returns {ValidationResult}
 */
function validatePassword(password) {
  const errors = [];

  if (!password) {
    errors.push('Password is required');
  } else if (typeof password !== 'string') {
    errors.push('Password must be a string');
  } else {
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a value is not empty.
 * @param {*} value - The value to check
 * @param {string} fieldName - The name of the field for error messages
 * @returns {ValidationResult}
 */
function validateRequired(value, fieldName) {
  const errors = [];

  if (value === null || value === undefined || value === '') {
    errors.push(`${fieldName} is required`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a string is within length bounds.
 * @param {string} value - The string to validate
 * @param {string} fieldName - The field name for error messages
 * @param {Object} options - Length options
 * @param {number} [options.min] - Minimum length
 * @param {number} [options.max] - Maximum length
 * @returns {ValidationResult}
 */
function validateLength(value, fieldName, { min, max }) {
  const errors = [];

  if (typeof value !== 'string') {
    errors.push(`${fieldName} must be a string`);
    return { valid: false, errors };
  }

  if (min !== undefined && value.length < min) {
    errors.push(`${fieldName} must be at least ${min} characters`);
  }

  if (max !== undefined && value.length > max) {
    errors.push(`${fieldName} must be at most ${max} characters`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Combine multiple validation results.
 * @param {...ValidationResult} results - Validation results to combine
 * @returns {ValidationResult}
 */
function combineValidations(...results) {
  const allErrors = results.flatMap((r) => r.errors);
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Create a validator that runs multiple validations.
 * @param {Object} schema - Validation schema
 * @returns {function(Object): ValidationResult}
 */
function createValidator(schema) {
  return function validate(data) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      for (const rule of rules) {
        const result = rule(value, field);
        if (!result.valid) {
          errors.push(...result.errors);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  };
}

module.exports = {
  validateEmail,
  validateUsername,
  validatePassword,
  validateRequired,
  validateLength,
  combineValidations,
  createValidator,
};
