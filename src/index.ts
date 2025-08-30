import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
dotenv.config();



const app = express();
const httpServer = createServer(app);



const port = process.env.PORT || 3000;
app.use(express.json());
httpServer.listen(port, () => {
  console.log(`orchestrator api listnoning on port:${port}`);
});

