// shared/frontend/hooks/useAuth.js
// Hook to read auth state from localStorage.
import { useState, useEffect } from "react";

export const useAuth = () => {
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem("access_token");
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }
  }, []);

  const logout = () => {
    localStorage.removeItem("access_token");
    setToken(null);
    setIsAuthenticated(false);
    window.location.href = "/login";
  };

  return { token, isAuthenticated, logout };
};
