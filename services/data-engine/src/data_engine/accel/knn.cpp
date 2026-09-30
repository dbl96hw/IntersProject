// Streaming, multi-threaded k-nearest-neighbour search (squared Euclidean distance).
//
// For each query row a_i we scan every row b_j once and keep the k best
// candidates in a max-heap of size k. Memory is O(k) per query instead of the
// O(m) row (or O(n*m) matrix) a dense GEMM formulation needs, which is what
// makes this worthwhile for very large candidate sets.
//
// Parallelism: query rows are independent, so they are split into contiguous
// blocks, one per std::thread. The thread count is chosen in Python from the
// hardware probe (physical cores: this loop is floating-point bound, so
// hyper-threads add little). No shared mutable state -> no locks needed.
//
// Build: python -m data_engine.accel.build   (g++ / clang++ / MSVC cl)
// ABI:   plain C, called from Python through ctypes (no pybind11 dependency).

#include <algorithm>
#include <queue>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#define EXPORT extern "C" __declspec(dllexport)
#else
#define EXPORT extern "C"
#endif

static void knn_block(const double* a, long row_begin, long row_end, const double* b, long m, long d,
                      long k, long* out_idx, double* out_dist) {
    for (long i = row_begin; i < row_end; ++i) {
        const double* ai = a + i * d;
        // max-heap on (distance, index): the top is the worst of the current k best.
        // Ties are broken by the smaller index so results are deterministic.
        std::priority_queue<std::pair<double, long>> heap;
        for (long j = 0; j < m; ++j) {
            const double* bj = b + j * d;
            double s = 0.0;
            for (long t = 0; t < d; ++t) {
                const double diff = ai[t] - bj[t];
                s += diff * diff;
            }
            if ((long)heap.size() < k) {
                heap.emplace(s, j);
            } else if (s < heap.top().first || (s == heap.top().first && j < heap.top().second)) {
                heap.pop();
                heap.emplace(s, j);
            }
        }
        for (long r = (long)heap.size() - 1; r >= 0; --r) {  // drain into ascending order
            out_idx[i * k + r] = heap.top().second;
            out_dist[i * k + r] = heap.top().first;
            heap.pop();
        }
    }
}

EXPORT void knn_sqeuclidean(const double* a, long n, const double* b, long m, long d, long k,
                            long* out_idx, double* out_dist, long n_threads) {
    if (n_threads < 1) n_threads = 1;
    if (n_threads > n) n_threads = n > 0 ? n : 1;
    if (n_threads == 1) {
        knn_block(a, 0, n, b, m, d, k, out_idx, out_dist);
        return;
    }
    std::vector<std::thread> workers;
    workers.reserve(n_threads);
    const long block = (n + n_threads - 1) / n_threads;
    for (long t = 0; t < n_threads; ++t) {
        const long begin = t * block;
        const long end = std::min(n, begin + block);
        if (begin >= end) break;
        workers.emplace_back(knn_block, a, begin, end, b, m, d, k, out_idx, out_dist);
    }
    for (auto& w : workers) w.join();
}
