// middlewares/roleCheck.js
export const checkRole = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      const userRole = req.user?.role;

      if (!userRole) {
        return res.status(403).json({
          success: false,
          message: "Role not found in user",
        });
      }

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: "Access denied: Insufficient role",
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Role check failed",
        error: error.message,
      });
    }
  };
};