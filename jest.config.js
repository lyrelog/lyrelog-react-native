module.exports = {
  preset: "@react-native/jest-preset",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  modulePathIgnorePatterns: ["<rootDir>/example", "<rootDir>/lib"],
};
