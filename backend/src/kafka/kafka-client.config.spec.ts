import { kafkaClientConfig } from './kafka-client.config';
describe('Kafka transport security', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it('requires TLS for production without printing credentials', () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKERS = 'broker:9093';
    process.env.KAFKA_SECURITY_PROTOCOL = 'PLAINTEXT';
    expect(() => kafkaClientConfig()).toThrow('requires TLS');
  });
  it('enables certificate verification by default in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKERS = 'broker:9093';
    delete process.env.KAFKA_SECURITY_PROTOCOL;
    expect(kafkaClientConfig().ssl).toMatchObject({ rejectUnauthorized: true });
  });
  it('allows explicit local plaintext and validates SASL', () => {
    process.env.NODE_ENV = 'test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.KAFKA_SECURITY_PROTOCOL = 'PLAINTEXT';
    expect(kafkaClientConfig().ssl).toBeUndefined();
    process.env.KAFKA_SECURITY_PROTOCOL = 'SASL_SSL';
    delete process.env.KAFKA_SASL_PASSWORD;
    expect(() => kafkaClientConfig()).toThrow('SASL');
  });
});
