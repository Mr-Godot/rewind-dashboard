import { createFileRoute } from '@tanstack/react-router'
import { ProjectAnalytics } from '@/features/project-analytics/ProjectAnalytics'

export const Route = createFileRoute('/_dashboard/projects')({
  component: ProjectsPage,
})

function ProjectsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-matrix">Projects</h1>
      <p className="mt-1 text-sm text-gray-400">
        Manage your Claude Code projects — pin, hide, and view sessions
      </p>
      <div className="mt-6">
        <ProjectAnalytics />
      </div>
    </div>
  )
}
