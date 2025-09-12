import { Router, Request, Response } from 'express';
import { AuthService, UserCreateRequest, LoginRequest } from '../services/auth-service';
import { createAuthMiddleware } from '../middleware/auth-middleware';

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  // Public routes
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const createRequest: UserCreateRequest = req.body;
      
      // Validate input
      if (!createRequest.email || !createRequest.username || !createRequest.password) {
        return res.status(400).json({ error: 'Email, username, and password are required' });
      }

      if (!createRequest.firstName || !createRequest.lastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }

      // Validate password strength
      if (createRequest.password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }

      // Create user (defaults to viewer role)
      const user = await authService.createUser(createRequest);
      
      // Auto-login after registration
      const { token } = await authService.login({
        username: createRequest.username,
        password: createRequest.password
      });

      res.json({ user, token });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const loginRequest: LoginRequest = req.body;
      
      if (!loginRequest.username || !loginRequest.password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const result = await authService.login(loginRequest);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });


  return router;
}