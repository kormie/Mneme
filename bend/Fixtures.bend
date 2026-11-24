import Base
import ./Kernel.bend as K

# Test fixtures for the laws. Not part of the Lean pack: a one-graph kernel
# with two nodes (a, b) and one edge (e1: a -> b), used as a green control for
# the kernel-dependent trace laws.

def tinyGraph() -> K.Graph:
  K.Graph{
    "pg-t",
    [K.Node{"a", K.Transform{}, []}, K.Node{"b", K.Transform{}, []}],
    [K.Edge{"e1", "a", "b", "out", "in", K.DataEdge{}, False{}, ""}],
    "mneme.graph/1"
  }

def tinyKernel() -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", [], [tinyGraph()], [], []}
