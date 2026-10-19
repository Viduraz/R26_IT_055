// vite.config.js
import { defineConfig, loadEnv } from "file:///C:/Users/minid/R26_IT_055/skeleton-identification/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/minid/R26_IT_055/skeleton-identification/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = mode === "tunnel" ? "/skeleton/" : "/";
  return {
    base,
    plugins: [react()],
    server: {
      port: 3e3,
      // Allow all hosts so the tunnel can reach Vite
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8007",
          changeOrigin: true
        },
        "/ws/stream": {
          target: "ws://127.0.0.1:8007",
          ws: true,
          changeOrigin: true
        },
        "/ws/ip-stream": {
          target: "ws://127.0.0.1:8007",
          ws: true,
          changeOrigin: true
        },
        "/health": {
          target: "http://127.0.0.1:8007",
          changeOrigin: true
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxtaW5pZFxcXFxSMjZfSVRfMDU1XFxcXHNrZWxldG9uLWlkZW50aWZpY2F0aW9uXFxcXGZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxtaW5pZFxcXFxSMjZfSVRfMDU1XFxcXHNrZWxldG9uLWlkZW50aWZpY2F0aW9uXFxcXGZyb250ZW5kXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9taW5pZC9SMjZfSVRfMDU1L3NrZWxldG9uLWlkZW50aWZpY2F0aW9uL2Zyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSdcclxuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xyXG4gIGNvbnN0IGVudiA9IGxvYWRFbnYobW9kZSwgcHJvY2Vzcy5jd2QoKSwgJycpXHJcblxyXG4gIC8vIFdoZW4gYWNjZXNzZWQgdGhyb3VnaCB0aGUgcmV2ZXJzZSBwcm94eSB2aWEgL3NrZWxldG9uLyBzdWJwYXRoLFxyXG4gIC8vIFZpdGUgbXVzdCBzZXQgYmFzZT0nL3NrZWxldG9uLycgc28gYWxsIGFzc2V0IFVSTHMgaW5jbHVkZSB0aGF0IHByZWZpeC5cclxuICAvLyBUaGlzIGVuc3VyZXMgL0B2aXRlL2NsaWVudCwgL3NyYy9tYWluLmpzeCwgZXRjLiBhcmUgcmVxdWVzdGVkIGFzXHJcbiAgLy8gL3NrZWxldG9uL0B2aXRlL2NsaWVudCwgL3NrZWxldG9uL3NyYy9tYWluLmpzeCBcdTIwMTQgd2hpY2ggdGhlIHByb3h5XHJcbiAgLy8gY29ycmVjdGx5IHJvdXRlcyBiYWNrIHRvIHBvcnQgMzAwMC5cclxuICBjb25zdCBiYXNlID0gbW9kZSA9PT0gJ3R1bm5lbCcgPyAnL3NrZWxldG9uLycgOiAnLydcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGJhc2UsXHJcbiAgICBwbHVnaW5zOiBbcmVhY3QoKV0sXHJcbiAgICBzZXJ2ZXI6IHtcclxuICAgICAgcG9ydDogMzAwMCxcclxuICAgICAgLy8gQWxsb3cgYWxsIGhvc3RzIHNvIHRoZSB0dW5uZWwgY2FuIHJlYWNoIFZpdGVcclxuICAgICAgaG9zdDogJzAuMC4wLjAnLFxyXG4gICAgICBwcm94eToge1xyXG4gICAgICAgICcvYXBpJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEyNy4wLjAuMTo4MDA3JyxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvd3Mvc3RyZWFtJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiAnd3M6Ly8xMjcuMC4wLjE6ODAwNycsXHJcbiAgICAgICAgICB3czogdHJ1ZSxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvd3MvaXAtc3RyZWFtJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiAnd3M6Ly8xMjcuMC4wLjE6ODAwNycsXHJcbiAgICAgICAgICB3czogdHJ1ZSxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvaGVhbHRoJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEyNy4wLjAuMTo4MDA3JyxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9XHJcbn0pXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFcsU0FBUyxjQUFjLGVBQWU7QUFDbFosT0FBTyxXQUFXO0FBR2xCLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3hDLFFBQU0sTUFBTSxRQUFRLE1BQU0sUUFBUSxJQUFJLEdBQUcsRUFBRTtBQU8zQyxRQUFNLE9BQU8sU0FBUyxXQUFXLGVBQWU7QUFFaEQsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxJQUNqQixRQUFRO0FBQUEsTUFDTixNQUFNO0FBQUE7QUFBQSxNQUVOLE1BQU07QUFBQSxNQUNOLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxVQUNOLFFBQVE7QUFBQSxVQUNSLGNBQWM7QUFBQSxRQUNoQjtBQUFBLFFBQ0EsY0FBYztBQUFBLFVBQ1osUUFBUTtBQUFBLFVBQ1IsSUFBSTtBQUFBLFVBQ0osY0FBYztBQUFBLFFBQ2hCO0FBQUEsUUFDQSxpQkFBaUI7QUFBQSxVQUNmLFFBQVE7QUFBQSxVQUNSLElBQUk7QUFBQSxVQUNKLGNBQWM7QUFBQSxRQUNoQjtBQUFBLFFBQ0EsV0FBVztBQUFBLFVBQ1QsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFFBQ2hCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
