import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'Orion Intelligence Engine API',
    description: 'Auto-generated OpenAPI documentation for Orion backend',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:8000',
      description: 'Local Development Server',
    },
  ],
};

const outputFile = './src/swagger-output.json';
// Point this to your main server file or combined router entry point
const endpointsFiles = ['./src/app.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, endpointsFiles, doc).then(() => {
  console.log('[Swagger Gen]: Documentation successfully generated.');
});