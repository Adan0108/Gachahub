export type ApiResponse<T> = {
  success: boolean;
  data: T;
  timestamp: string;
};
