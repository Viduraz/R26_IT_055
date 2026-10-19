import api from "./api";

export const validatePatientId = async (patientId) => {
  const response = await api.get(`/monitor/validate/${patientId}`);
  return response.data;
};

export const getPatientLiveStatus = async (patientId) => {
  const response = await api.get(`/monitor/status/${patientId}`);
  return response.data;
};

export const getVideoFrame = async (patientId) => {
  const response = await api.get(`/monitor/video-frame/${patientId}`);
  return response.data; // { frame: "data:image/jpeg;base64,..." }
};
