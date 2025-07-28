const net = require('net');
const admin = require('firebase-admin');

// Inicializar Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://proyecto-gps-bdc43-default-rtdb.firebaseio.com/'
});

const db = admin.database();

// Convertir DMM (grados y minutos) a grados decimales
function convertToDecimalDegrees(coord, direction) {
  const dmm = parseFloat(coord);
  const degrees = Math.floor(dmm / 100);
  const minutes = dmm % 100;
  let decimal = degrees + (minutes / 60);

  if (direction === 'S' || direction === 'W') {
    decimal = -decimal;
  }

  return decimal;
}

// Función para parsear tramas extendidas de Coban 303G
function parseCobanData(dataStr) {
  const pattern = /imei:(\d+),tracker,(\d+),[^,]*,([FL]),([\d.]+),([AV]),([\d.]+),([NS]),([\d.]+),([EW]),([\d.]+),([\d.]+),.*;/;
  const match = dataStr.match(pattern);

  if (match) {
    const [, imei, timestamp, gpsSignal, time, validity,
      lat, latDir, lon, lonDir, speed, course] = match;

    const latitude = convertToDecimalDegrees(lat, latDir);
    const longitude = convertToDecimalDegrees(lon, lonDir);

    return {
      imei,
      timestamp: parseInt(timestamp),
      gpsSignal,
      time,
      validity,
      latitude,
      longitude,
      speed: parseFloat(speed),
      course: parseFloat(course),
      receivedAt: Date.now()
    };
  }

  return null;
}

// Crear servidor TCP
const server = net.createServer((socket) => {
  console.log('Cliente conectado:', socket.remoteAddress);

  socket.on('data', async (data) => {
    try {
      const dataStr = data.toString().trim();
      console.log('Datos recibidos:', dataStr);

      // Handshake: responder con LOAD
      if (dataStr.startsWith('##')) {
        socket.write('LOAD');
        console.log('>> Handshake detectado. Se envió LOAD.');
        return;
      }

      // Si es solo IMEI sin datos GPS
      if (/^\d+;$/.test(dataStr)) {
        console.log('>> IMEI recibido sin datos GPS. Esperando más información...');
        return;
      }

      // Procesar trama de datos GPS
      const parsedData = parseCobanData(dataStr);
      if (parsedData) {
        const ref = db.ref(`gps-data/${parsedData.imei}`);
        await ref.push(parsedData);

        const lastLocationRef = db.ref(`last-location/${parsedData.imei}`);
        await lastLocationRef.set(parsedData);

        console.log(`>> Datos guardados en Firebase para IMEI: ${parsedData.imei}`);
        socket.write('ON'); // Confirmación al dispositivo
      } else {
        console.log('>> Trama no válida o no reconocida.');
      }

    } catch (error) {
      console.error('Error procesando datos:', error);
    }
  });

  socket.on('end', () => {
    console.log('Cliente desconectado');
  });

  socket.on('error', (error) => {
    console.error('Error en socket:', error);
  });
});

// Iniciar servidor
const PORT = 5013;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor TCP escuchando en el puerto ${PORT}`);
});

// Manejar cierre del servidor
process.on('SIGINT', () => {
  console.log('\nCerrando servidor...');
  server.close(() => {
    process.exit(0);
  });
});
