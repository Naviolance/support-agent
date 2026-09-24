// Try the store tools by hand, before the agent exists.
//
//   npm run store:try -- order ORD-20260920-K3F9QZ "+237 699 000 000"
//   npm run store:try -- search "brake pad"
//
// Starts the Nest app without the HTTP server, calls StoreService and prints
// exactly what the agent will receive.
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { StoreService } from '../store/store.service.js';

const [command, ...args] = process.argv.slice(2);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const store = app.get(StoreService);

try {
  if (command === 'order' && args.length === 2) {
    const order = await store.getOrder(args[0], args[1]);
    console.log(order ?? 'No order matches this order number and phone.');
  } else if (command === 'search' && args.length === 1) {
    console.log(await store.searchProducts(args[0]));
  } else {
    console.log(
      'Usage:\n  store:try -- order <orderNumber> <phone>\n  store:try -- search <text>',
    );
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
