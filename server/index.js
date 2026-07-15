const path = require('path');
const express = require('express');
const { sessionMiddleware } = require('./auth');
const authRoutes = require('./routes/auth');
const storeRoutes = require('./routes/store');
const uploadRoutes = require('./routes/uploads');

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// Límite amplio para permitir subir fotos (dataURL base64) por JSON.
app.use(express.json({ limit: '12mb' }));
app.use(sessionMiddleware);

app.use('/api', authRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/upload', uploadRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PanControl escuchando en http://localhost:${PORT}`);
});
