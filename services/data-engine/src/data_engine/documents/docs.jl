# PDF text extraction with PDFIO.jl (pure Julia, no Poppler dependency).
# Loaded by data_engine.documents.julia_backend through juliacall.
# Install once:  julia> using Pkg; Pkg.add("PDFIO")

const _PDFIO_OK = try
    @eval using PDFIO
    true
catch
    false
end

pdfio_loaded() = _PDFIO_OK

"""
    pdf_text(path) -> Vector{String}

One string per page, extracted from the PDF text layer (no OCR).
"""
function pdf_text(path::AbstractString)
    doc = pdDocOpen(path)
    pages = String[]
    try
        for i in 1:pdDocGetPageCount(doc)
            io = IOBuffer()
            pdPageExtractText(io, pdDocGetPage(doc, i))
            push!(pages, String(take!(io)))
        end
    finally
        pdDocClose(doc)
    end
    return pages
end
