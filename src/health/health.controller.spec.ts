import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
