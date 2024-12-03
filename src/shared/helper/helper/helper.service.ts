import { Injectable } from '@nestjs/common';

@Injectable()
export class HelperService {

    roundUpToFiveDecimals(value: number): number {
        const factor = Math.pow(10, 5); // 10^5 for 5 decimal places
        return Math.ceil(value * factor) / factor;
    }
}
