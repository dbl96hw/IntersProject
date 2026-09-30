# Streaming k-nearest-neighbour search, Julia back-end (same contract as knn.cpp).
#
# Loaded through juliacall. The number of Julia threads is fixed when Julia
# starts, so data_engine.accel sets PYTHON_JULIACALL_THREADS from the hardware
# probe (physical cores) *before* importing juliacall. Query rows are split
# across those threads with Threads.@threads; each row owns its output slice,
# so there is no shared mutable state.
#
# Returns 1-based indices (converted to 0-based in Python). The first call
# pays Julia's JIT compilation (seconds): only worth it for large n.

function knn_sqeuclidean(A::AbstractMatrix{Float64}, B::AbstractMatrix{Float64}, k::Integer)
    n, d = size(A)
    m = size(B, 1)
    idx = Matrix{Int}(undef, n, k)
    dist = Matrix{Float64}(undef, n, k)
    Bt = permutedims(B)                      # column-major friendly: each b_j is a column
    Threads.@threads for i in 1:n
        best_d = fill(Inf, k)
        best_j = zeros(Int, k)
        @inbounds for j in 1:m
            s = 0.0
            @simd for t in 1:d
                diff = A[i, t] - Bt[t, j]
                s += diff * diff
            end
            if s < best_d[k]
                # insertion into the sorted top-k buffer
                pos = k
                while pos > 1 && best_d[pos - 1] > s
                    best_d[pos] = best_d[pos - 1]
                    best_j[pos] = best_j[pos - 1]
                    pos -= 1
                end
                best_d[pos] = s
                best_j[pos] = j
            end
        end
        idx[i, :] = best_j
        dist[i, :] = best_d
    end
    return idx, dist
end

nthreads_used() = Threads.nthreads()
