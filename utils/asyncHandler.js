const asyncHandler = (fn) => (req, res, next) => {
  // also catch errors
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Use this middleware in routes
export default asyncHandler;
