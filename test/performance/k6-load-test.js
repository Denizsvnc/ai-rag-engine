import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Enterprise k6 Load Test for AI-RAG-ENGINE
 * Run with:
 *   k6 run test/performance/k6-load-test.js
 */

export const options = {
    stages: [
        { duration: '10s', target: 20 },  // Ramp-up to 20 virtual users
        { duration: '30s', target: 50 },  // Sustained load at 50 virtual users
        { duration: '10s', target: 0 },   // Cool-down
    ],
    thresholds: {
        http_req_duration: ['p(95)<250'], // 95% of requests must complete below 250ms
        http_req_failed: ['rate<0.01'],    // Error rate must be less than 1%
    },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://127.0.0.1:3000/api';

export default function () {
    // 1. Health check
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
        'health check status is 200': (r) => r.status === 200,
    });

    // 2. Metrics check
    const metricsRes = http.get(`${BASE_URL}/metrics`);
    check(metricsRes, {
        'metrics status is 200': (r) => r.status === 200,
    });

    // 3. Hot Query (Cache hit / SML path)
    const queryPayload = JSON.stringify({
        query: 'İade koşulları ve kargo süresi nedir?',
    });

    const queryParams = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const queryRes = http.post(`${BASE_URL}/query`, queryPayload, queryParams);
    check(queryRes, {
        'query status is 200': (r) => r.status === 200,
        'query has answer': (r) => JSON.parse(r.body).answer !== undefined,
    });

    // 4. Asynchronous Document Ingestion with PII Sanitization
    const ingestPayload = JSON.stringify({
        filename: `customer_record_${__VU}_${__ITER}.txt`,
        content: 'Müşteri Mehmet, T.C. Kimlik: 10000000146, Kart: 4532-0150-1234-5671 ile alışveriş yaptı.',
    });

    const ingestRes = http.post(`${BASE_URL}/ingest`, ingestPayload, queryParams);
    check(ingestRes, {
        'ingest status is 202': (r) => r.status === 202,
        'ingest has jobId': (r) => JSON.parse(r.body).jobId !== undefined,
    });

    sleep(0.5);
}
