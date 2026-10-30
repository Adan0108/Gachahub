import type { KafkaConfig } from 'kafkajs';
import { readFileSync } from 'node:fs';

/** Same TLS/SASL boundary for producers, notifications and analysis result ingestion. */
export function kafkaClientConfig(): KafkaConfig {
  const brokers = process.env.KAFKA_BROKERS?.split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (!brokers?.length) throw new Error('KAFKA_BROKERS is missing');
  const production = (process.env.NODE_ENV ?? 'production') === 'production';
  const protocol =
    process.env.KAFKA_SECURITY_PROTOCOL ?? (production ? 'SSL' : 'PLAINTEXT');
  if (
    !['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL'].includes(protocol) ||
    (production && !['SSL', 'SASL_SSL'].includes(protocol))
  )
    throw new Error('Kafka requires TLS in production');
  const config: KafkaConfig = {
    clientId: process.env.KAFKA_CLIENT_ID ?? 'gachahub-backend',
    brokers,
    retry: { retries: 8 },
  };
  if (protocol.includes('SSL')) {
    const ca = process.env.KAFKA_SSL_CA_LOCATION;
    const cert = process.env.KAFKA_SSL_CERTIFICATE_LOCATION;
    const key = process.env.KAFKA_SSL_KEY_LOCATION;
    if (Boolean(cert) !== Boolean(key))
      throw new Error(
        'Kafka client certificate and key must be supplied together',
      );
    config.ssl = {
      rejectUnauthorized: true,
      ...(ca ? { ca: [readFileSync(ca, 'utf8')] } : {}),
      ...(cert && key
        ? {
            cert: readFileSync(cert, 'utf8'),
            key: readFileSync(key, 'utf8'),
            passphrase: process.env.KAFKA_SSL_KEY_PASSWORD,
          }
        : {}),
    };
  }
  if (protocol.startsWith('SASL')) {
    const mechanism = (
      process.env.KAFKA_SASL_MECHANISM ?? 'SCRAM-SHA-512'
    ).toLowerCase();
    const username = process.env.KAFKA_SASL_USERNAME;
    const password = process.env.KAFKA_SASL_PASSWORD;
    if (
      !['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism) ||
      !username ||
      !password
    )
      throw new Error('Valid Kafka SASL configuration is required');
    config.sasl = { mechanism: mechanism as 'plain', username, password };
  }
  return config;
}
