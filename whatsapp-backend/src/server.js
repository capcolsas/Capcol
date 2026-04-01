import app from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`WhatsApp backend escuchando en puerto ${config.port}`);
});
