# Security Audit Checklist

## Pre-Deployment Security Review

### Authentication
- [ ] JWT secret is at least 32 characters, cryptographically random
- [ ] API keys hashed with SHA-256 + timing-safe comparison
- [ ] JWT tokens have TTL (default: 1 hour)
- [ ] No hardcoded secrets in source code
- [ ] Environment variables used for all secrets

### Encryption
- [ ] AES-256-GCM used for secret encryption
- [ ] Unique IV (16 bytes) per encryption operation
- [ ] Auth tag validated on decryption
- [ ] scrypt with salt for key derivation (memory: 64MB, ops: 3)
- [ ] No plaintext secrets in SQLite

### Rate Limiting
- [ ] Per-user rate limits enforced
- [ ] Rate limit headers returned (X-RateLimit-Remaining, X-RateLimit-Reset)
- [ ] 429 response on limit exceeded
- [ ] Default: 100 requests/minute per user

### Input Validation
- [ ] All user input validated before processing
- [ ] SQL injection prevention (parameterized queries)
- [ ] No `eval()` or dynamic code execution
- [ ] File path traversal prevention
- [ ] Max request body size enforced

### WebSocket Security
- [ ] WebSocket upgrade requires valid origin check
- [ ] Message size limits enforced (1MB max)
- [ ] Client disconnect handled gracefully

### Network
- [ ] HTTPS recommended in production
- [ ] CORS configured appropriately
- [ ] No sensitive data in logs
- [ ] Error messages don't leak internal details

### Dependencies
- [ ] No known CVEs in dependencies
- [ ] Minimal dependency footprint
- [ ] Regular `bun audit` runs

### Data Protection
- [ ] Backup/restore procedure documented
- [ ] Secrets not included in backups
- [ ] Database file permissions restricted

## Security Testing Commands

```bash
# Run load test
bun scripts/load-test.ts --concurrent=50 --requests=1000

# Check for CVEs
bun audit

# Test rate limiting
for i in {1..110}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18678/health; done

# Test encryption
curl -X POST http://localhost:18678/api/encrypt -H "Content-Type: application/json" -d '{"secret":"test"}'
```

## Incident Response

1. Revoke affected API keys via `/api/keys` revocation
2. Rotate JWT secret immediately
3. Rotate encryption key - re-encrypt all secrets
4. Review access logs for unauthorized access
5. Enable detailed logging for forensics
