import { Injectable } from '@nestjs/common';

@Injectable()
export class HelperService {

    roundUpToDecimals(value: number, decimal: number): number {
        const factor = Math.pow(10, decimal);
        return Math.ceil(value * factor) / factor;
    }
}
