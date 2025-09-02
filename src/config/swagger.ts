// src/config/swagger.ts
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Loomiq API",
      version: "1.0.0",
      description: "API documentation for Loomiq backend.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local Development",
      },
    ],
  },
  apis: ["./src/routes/*.ts"], // you can expand later
};

const swaggerSpec = swaggerJSDoc(options);

export const setupSwagger = (app: Express) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  console.log("Swagger docs available at http://localhost:3000/api-docs");
};
