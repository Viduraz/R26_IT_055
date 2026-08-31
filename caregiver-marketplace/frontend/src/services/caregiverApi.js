import api from "./api";

export const searchCaregivers = async (filters = {}) => {
  const response = await api.get("/caregivers", { params: filters });
  return response.data;
};

export const getCaregiverById = async (id) => {
  const response = await api.get(`/caregivers/${id}`);
  return response.data;
};

export const updateCaregiverProfile = async (updates) => {
  const response = await api.put("/caregivers/profile", updates);
  return response.data;
};

export const getCaregiverReviews = async (caregiverId) => {
  const response = await api.get(`/reviews/caregiver/${caregiverId}`);
  return response.data;
};

export const submitCaregiverReview = async (reviewData) => {
  const response = await api.post("/reviews", reviewData);
  return response.data;
};
