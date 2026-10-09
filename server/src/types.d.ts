import type { Row } from './db/index.ts';

declare global {
  namespace Express {
    interface Request {
      user?: Row & {
        id: number;
        account_type: string;
        username: string;
        display_name: string;
        role: string;
        status: string;
      };
      sessionId?: string;
    }
  }
}

export {};
