import SimulatorWrapper from './SimulatorWrapper';

interface Props { params: { id: string } }

export default function SimulatorPage({ params }: Props) {
  return <SimulatorWrapper id={params.id} />;
}