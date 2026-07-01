// import {
//   CallHandler,
//   ExecutionContext,
//   Injectable,
//   NestInterceptor,
// } from '@nestjs/common';
// import { Observable, map } from 'rxjs';

// @Injectable()
// export class ResponseInterceptor<T> implements NestInterceptor<T, { success: true; data: T; timestamp: string }>
// {
//   intercept(
//     _context: ExecutionContext,
//     next: CallHandler<T>,
//   ): Observable<{ success: true; data: T; timestamp: string }> {
//     return next.handle().pipe(
//       map((data: T) => ({
//         success: true,
//         data,
//         timestamp: new Date().toISOString(),
//       })),
//     );
//   }
// }
