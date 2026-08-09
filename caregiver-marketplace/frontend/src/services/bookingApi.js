import api from "./api";

export const createBooking = async (bookingData) => {
  const response = await api.post("/bookings", bookingData);
  return response.data;
};

export const listBookings = async () => {
  const response = await api.get("/bookings");
  return response.data;
};

export const getBookingDetails = async (bookingId) => {
  const response = await api.get(`/bookings/${bookingId}`);
  return response.data;
};

export const cancelBooking = async (bookingId) => {
  const response = await api.post(`/bookings/${bookingId}/cancel`);
  return response.data;
};

export const resendPatientId = async (bookingId, channels = { via_email: true, via_sms: false }) => {
  const response = await api.post(`/bookings/${bookingId}/resend-id`, channels);
  return response.data;
};
