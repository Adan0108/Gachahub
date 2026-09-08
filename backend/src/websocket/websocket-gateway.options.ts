import { appConfig } from '../config/app.config';

// shared by every gateway so they all attach to the same CORS-enabled server
export const websocketGatewayOptions = {
  cors: {
    origin: appConfig.frontendUrl,
    credentials: true,
  },
};
