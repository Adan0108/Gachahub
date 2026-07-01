// import {
//   BadRequestException,
//   Injectable,
//   PipeTransform,
// } from '@nestjs/common';

// @Injectable()
// export class ParseCuidPipe implements PipeTransform<string, string> {
//   transform(value: string): string {
//     const isValidCuid = /^c[a-z0-9]{24,}$/i.test(value);

//     if (!isValidCuid) {
//       throw new BadRequestException('Invalid id format');
//     }

//     return value;
//   }
// }
